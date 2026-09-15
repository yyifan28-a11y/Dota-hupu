FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY requirements.txt ./
RUN python3 -m venv /opt/replay-venv \
    && /opt/replay-venv/bin/pip install --no-cache-dir --disable-pip-version-check -r requirements.txt

COPY . .

ENV NODE_ENV=production
ENV REPLAY_PYTHON=/opt/replay-venv/bin/python

EXPOSE 3000

CMD ["npm", "start"]
