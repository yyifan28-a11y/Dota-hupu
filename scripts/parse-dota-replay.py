#!/usr/bin/env python3
"""Parse one Dota 2 Source 2 replay into the compact website import shape."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gem.combat.aggregator import _CombatAggregator
from gem.catalog import ability_display, item_display, load_data_json
from gem.extractors.courier import CourierExtractor
from gem.extractors.draft import DraftExtractor
from gem.extractors.intervals import IntervalExtractor
from gem.extractors.objectives import ObjectivesExtractor
from gem.extractors.players import PlayerExtractor
from gem.extractors.smoke_vision import SmokeExtractor, VisionModifierExtractor
from gem.extractors.wards import WardsExtractor
from gem.parser import ReplayParser
from gem.results.assembly import build_parsed_match


ABILITY_IDS_PATH = Path(__file__).resolve().parents[1] / "assets" / "dota-ability-ids.json"

try:
    ABILITY_IDS = json.loads(ABILITY_IDS_PATH.read_text(encoding="utf-8"))
except Exception:
    try:
        ABILITY_IDS = load_data_json("ability_ids.json")
    except Exception:
        ABILITY_IDS = {}


def parse_with_metadata(path: Path):
    parser = ReplayParser(path)
    player_ext = PlayerExtractor()
    objective_ext = ObjectivesExtractor()
    ward_ext = WardsExtractor()
    courier_ext = CourierExtractor()
    draft_ext = DraftExtractor()
    interval_ext = IntervalExtractor()

    player_ext.attach(parser)
    interval_ext.attach(parser)
    objective_ext.attach(parser)
    ward_ext.attach(parser)
    courier_ext.attach(parser)
    draft_ext.attach(parser)

    combat_agg = _CombatAggregator(player_ext)
    parser.on_combat_log_entry(combat_agg.on_entry)
    combat_entries = []
    parser.on_combat_log_entry(combat_entries.append)
    chat_entries = []
    parser.on_chat_message(chat_entries.append)
    neutral_item_finds = []
    parser.on_neutral_item_found(neutral_item_finds.append)

    smoke_ext = SmokeExtractor(player_ext)
    vision_ext = VisionModifierExtractor(player_ext)
    smoke_ext.attach(parser)
    vision_ext.attach(parser)

    parser.parse()
    if parser.parse_error is not None:
        raise RuntimeError(
            f"Replay parsing stopped at tick {parser.truncated_at_tick}: {parser.parse_error}"
        )

    draft_ext.finalize()
    ward_ext.finalize()
    match = build_parsed_match(
        parser=parser,
        player_ext=player_ext,
        obj_ext=objective_ext,
        ward_ext=ward_ext,
        courier_ext=courier_ext,
        draft_ext=draft_ext,
        combat_agg=combat_agg,
        all_entries=combat_entries,
        chat_entries=chat_entries,
        smoke_events=smoke_ext.finalize(),
        vision_modifier_events=vision_ext.finalize(),
        neutral_item_finds=neutral_item_finds,
        interval_ext=interval_ext,
    )
    return parser, match, player_ext


def ability_key_from_id(ability_id):
    return str(ABILITY_IDS.get(str(int(ability_id or 0)), ""))


def is_talent_key(ability_key):
    return ability_key.startswith("special_bonus_") and ability_key != "special_bonus_attributes"


def select_learned_increments(increments, upgrade_ids, start_index, capacity):
    """Discard innate/facet abilities that appear in snapshots without spending a point."""
    remaining = list(increments)
    selected = []
    for offset in range(capacity):
        upgrade_index = start_index + offset
        expected_key = ability_key_from_id(upgrade_ids[upgrade_index]) if upgrade_index < len(upgrade_ids) else ""
        if expected_key and expected_key in remaining:
            remaining.remove(expected_key)
            selected.append(expected_key)
    if len(selected) < capacity:
        selected.extend(remaining[-(capacity - len(selected)):])
    return selected[:capacity]


def build_ability_timeline(snapshots, player):
    """Reconstruct the hero level at which each skill point was spent."""
    previous = {}
    used_levels = set()
    result = []
    upgrade_ids = list(player.ability_upgrades_arr or [])

    for snapshot in snapshots:
        if snapshot.player_id != player.player_id or not snapshot.ability_levels:
            continue
        current = dict(snapshot.ability_levels)
        increments = []
        for key, level in current.items():
            gained = max(0, int(level or 0) - int(previous.get(key, 0) or 0))
            increments.extend([key] * gained)
        if increments:
            hero_level = max(1, int(snapshot.level or 0))
            available_levels = [level for level in range(1, hero_level + 1) if level not in used_levels]
            remaining_upgrades = max(0, len(upgrade_ids) - len(result))
            point_count = min(len(increments), len(available_levels), remaining_upgrades)
            learned_increments = select_learned_increments(increments, upgrade_ids, len(result), point_count)
            assigned_levels = available_levels[-len(learned_increments):]
            for snapshot_key, learned_level in zip(learned_increments, assigned_levels, strict=False):
                index = len(result)
                ability_id = int(upgrade_ids[index]) if index < len(upgrade_ids) else 0
                ability_key = ability_key_from_id(ability_id) or snapshot_key
                result.append(
                    {
                        "level": learned_level,
                        "abilityId": ability_id,
                        "key": ability_key,
                        "name": ability_display(ability_key),
                        "talent": is_talent_key(ability_key),
                    }
                )
                used_levels.add(learned_level)
        previous = current

    if result:
        return sorted(result, key=lambda item: item["level"])

    fallback = []
    for level, ability_id in enumerate(upgrade_ids, start=1):
        if not int(ability_id or 0):
            continue
        ability_key = ability_key_from_id(ability_id)
        fallback.append(
            {
                "level": level,
                "abilityId": int(ability_id or 0),
                "key": ability_key,
                "name": ability_display(ability_key) if ability_key else str(ability_id),
                "talent": is_talent_key(ability_key),
            }
        )
    return fallback


def value_at_game_time(player, seconds: int):
    times = player.game_times_min or player.times_min
    try:
        index = times.index(seconds)
    except ValueError:
        return 0
    return player.net_worth_t_min[index] if index < len(player.net_worth_t_min) else 0


def suggest_positions(players):
    suggestions = {}
    for is_radiant in (True, False):
        team = [player for player in players if player.is_radiant == is_radiant]
        remaining = set(player.player_id for player in team)

        def choose(role):
            candidates = [player for player in team if player.player_id in remaining and player.lane_role == role]
            if not candidates:
                return None
            selected = max(candidates, key=lambda player: value_at_game_time(player, 600))
            remaining.remove(selected.player_id)
            return selected

        for role, position in ((2, "2"), (1, "1"), (3, "3")):
            selected = choose(role)
            if selected is not None:
                suggestions[selected.player_id] = position

        unassigned = sorted(
            (player for player in team if player.player_id in remaining),
            key=lambda player: value_at_game_time(player, 600),
            reverse=True,
        )
        for player, position in zip(unassigned, ("4", "5"), strict=False):
            suggestions[player.player_id] = position
    return suggestions


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: parse-dota-replay.py <replay.dem>")

    path = Path(sys.argv[1])
    parser, match, player_ext = parse_with_metadata(path)
    start_time = int(getattr(parser.match_details, "starttime", 0) or 0)
    started_at = datetime.fromtimestamp(start_time, timezone.utc) if start_time else None
    local_started_at = started_at.astimezone(timezone(timedelta(hours=8))) if started_at else None
    suggestions = suggest_positions(match.players)

    players = []
    for player in match.players:
        ability_build = build_ability_timeline(player_ext.snapshots, player)

        final_items = []
        for slot, item_name in sorted((player.final_items or {}).items(), key=lambda entry: int(entry[0])):
            key = str(item_name or "").removeprefix("item_")
            final_items.append(
                {
                    "slot": int(slot),
                    "key": key,
                    "name": item_display(key),
                }
            )

        players.append(
            {
                "slot": player.player_id,
                "team": "radiant" if player.is_radiant else "dire",
                "playerName": player.player_name,
                "steamId": str(player.steam_id or ""),
                "accountId": str(player.account_id or ""),
                "heroSlug": player.hero_name.removeprefix("npc_dota_hero_"),
                "heroId": player.hero_id,
                "suggestedPosition": suggestions.get(player.player_id, ""),
                "laneRole": player.lane_role,
                "kills": player.kills,
                "deaths": player.deaths,
                "assists": player.assists,
                "gpm": player.gold_per_min,
                "xpm": player.xp_per_min,
                "lastHits": player.last_hits,
                "denies": player.denies,
                "netWorth10": value_at_game_time(player, 600),
                "netWorth": player.net_worth,
                "damage": player.hero_damage,
                "buildingDamage": player.tower_damage,
                "damageTaken": sum(player.damage_taken.values()),
                "healing": player.hero_healing,
                "level": player.level,
                "netWorth": player.net_worth,
                "abilityBuild": ability_build,
                "finalItems": final_items,
                "purchaseTimes": dict(player.purchase_time or {}),
                "buffs": {
                    "aghanimsScepter": player.aghanims_scepter,
                    "aghanimsShard": player.aghanims_shard,
                    "moonshard": player.moonshard,
                },
            }
        )

    duration = int(match.duration or round(match.duration_seconds))
    payload = {
        "parser": "gem-dota",
        "parserVersion": "0.8.0",
        "matchId": str(match.match_id or ""),
        "gameMode": match.game_mode,
        "startedAt": local_started_at.isoformat() if local_started_at else "",
        "date": local_started_at.date().isoformat() if local_started_at else "",
        "winner": (
            "radiant"
            if match.radiant_win is True
            else "dire"
            if match.radiant_win is False
            else ""
        ),
        "radiantScore": match.radiant_score,
        "direScore": match.dire_score,
        "durationSeconds": duration,
        "firstBloodTime": match.first_blood_time,
        "timeline": {
            "times": list(match.game_times_min or []),
            "goldAdvantage": list(match.radiant_gold_adv or []),
            "xpAdvantage": list(match.radiant_xp_adv or []),
        },
        "players": players,
        "summary": {
            "towers": len(match.towers),
            "barracks": len(match.barracks),
            "roshans": len(match.roshans),
            "wards": len(match.wards),
            "teamfights": len(match.teamfights),
        },
    }
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
