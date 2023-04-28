FROM node:18

# timezone
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN apt-get update && \
  apt-get install -yq gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
  libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 \
  libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
  fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-khmeros fonts-freefont-ttf \
  ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget xfonts-utils libgbm-dev && \
  rm -rf /var/lib/apt/lists/*

# ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true

RUN groupadd -r puppteer && useradd -r -g puppteer -G audio,video puppteer \
  && mkdir -p /home/puppteer/Downloads \
  && chown -R puppteer:puppteer /home/puppteer \
  && mkdir -p /app \
  && chown -R puppteer:puppteer /app

WORKDIR /app

USER puppteer

# install fonts
COPY fonts/*.* /usr/share/fonts/truetype/
RUN mkfontscale && mkfontdir && fc-cache

COPY --chown=puppteer:puppteer . /app

# init process
RUN chmod +x ./tini
ENTRYPOINT ["./tini", "--"]

RUN pnpm install && pnpm run build

EXPOSE 3030
CMD ["node", "dist/index.js"]