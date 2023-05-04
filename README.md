## simple screenshot service, powered by puppeteer

### Usage

```shell
docker build . -t screenshot:1.0.0
docker run -d -p 3030:3030 -e CHROMIUM_NUM=3 screenshot:1.0.0
# optional env: see .env file
```

### API

`localhost:3030/api/screenshot`

```typescript
// x-www-form-urlencoded
type getScreenshotArguments = {
  url?: string; // screenshot website's url
  html?: string; // use html doc
  selector?: string; // css selector
  type?: "pdf" | "picture"; // output type, default picture
};
```
