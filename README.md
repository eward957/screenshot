### simple screenshot service, powered by puppeteer

### Usage

```shell
docker build . -t screenshot:1.0.0
docker run -d -p 3030:3030 screenshot:1.0.0
```

### API

`localhost:3030/api/screenshot`

```typescript
// x-www-form-urlencoded
{
  url: string,
  selector?: string
}

```
