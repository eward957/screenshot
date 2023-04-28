import * as dotenv from "dotenv";
import Koa from "koa";
import Router from "koa-router";
import bodyParser from "koa-bodyparser";
import rateLimit from "koa-ratelimit";
import { EventEmitter } from "events";
import log4js from "log4js";
import { queue, QueueObject } from "async";
import Puppeteer, { PDFOptions } from "puppeteer";

dotenv.config();

type ExtendsGlobal = {
  ChromiumInstPool: import("puppeteer").Browser[];
  ChromiumCurrentIndex: number;
  ServerStartTime: number;
  restarting: boolean;
  screenshoting: boolean;
  queue: QueueObject<{ params: getScreenshotArguments; ctx: Koa.Context }>;
  rateLimitMap: Map<any, any>;
  app: Koa;
};

// the request's arguments
type getScreenshotArguments = {
  url?: string;
  html?: string;
  selector?: string;
  type?: "pdf" | "picture";
};

const config = {
  port: 3030,
  defaultOutName: "file",
  timeout: parseInt(process.env.SCREENSHOT_TIMEOUT || "10000"),
  restartChromeInstanceGutterTime: parseInt(
    process.env.RESTART_HOUR || "43200000"
  ),
  ChromiumInstPoolSize: parseInt(process.env.CHROMIUM_NUM || "1"),
  maxQueue: parseInt(process.env.CONCURRENCY || "10"),
  maxRateLimit: parseInt(process.env.RATE_LIMIT || "100"),
};

declare var global: ExtendsGlobal;

// logs
const { getLogger, configure } = log4js;

EventEmitter.defaultMaxListeners = 30;

configure({
  appenders: {
    info: {
      type: "dateFile",
      filename: "./log/info",
      pattern: ".yyyy-MM-dd.log",
      alwaysIncludePattern: true,
    },
    error: {
      type: "dateFile",
      filename: "./log/error",
      pattern: ".yyyy-MM-dd.log",
      alwaysIncludePattern: true,
    },
  },
  categories: {
    error: { appenders: ["error"], level: "error" },
    default: { appenders: ["info"], level: "info" },
  },
});

export const logger = getLogger("default");
export const errorLogger = getLogger("error");

logger.level = "debug";

// utils:
export async function startChromiums() {
  logger.info("start all chromium");
  for (let i = 0; i < config.ChromiumInstPoolSize; i++) {
    global.ChromiumInstPool[i] = await Puppeteer.launch({
      headless: true,
      ignoreHTTPSErrors: true,
      defaultViewport: {
        width: 1366,
        height: 768,
      },
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "–-no-first-run",
        "–-no-zygote",
        "–-single-process",
        "--disable-extensions",
      ],
    });
  }
  logger.info(
    "chromium start completed, total: " + config.ChromiumInstPoolSize
  );
}

// check arguments
export function checkArguments(body: getScreenshotArguments): {
  message: string;
  hasError: boolean;
} {
  let message = "arguments error";
  let hasError = true;
  if (typeof body.url === "string" || typeof body.html === "string") {
    message = "";
    hasError = false;
  }
  return {
    message,
    hasError,
  };
}

export async function waitRestarting() {
  if (global.restarting) {
    await new Promise((res) => {
      setInterval(() => {
        if (!global.restarting) res(null);
      }, 100);
    });
  }
}

global.ChromiumCurrentIndex = -1;

// screenshot
export async function getScreenshot({
  url,
  selector,
  html,
  type,
}: getScreenshotArguments): Promise<Buffer> {
  global.ChromiumCurrentIndex =
    (global.ChromiumCurrentIndex + 1) % global.ChromiumInstPool.length;
  let browser = global.ChromiumInstPool[global.ChromiumCurrentIndex];
  if (!browser) {
    await startChromiums();
    browser = global.ChromiumInstPool[global.ChromiumCurrentIndex];
  }
  logger.info(`chrome pool index： ${global.ChromiumCurrentIndex}`);
  logger.info(`new page start`);
  const page = await browser.newPage();
  page.setDefaultTimeout(config.timeout);
  logger.info(`new page end`);
  if (url) {
    logger.info(`goto page start ------ ${url}`);
    await page.goto(url, {
      // waitUntil: selector ? "load" : "networkidle0",
    });
    logger.info(`goto page end ------ ${url}`);
  } else if (html) {
    logger.info(`start render html and screenShot`);
    await page.setContent(html);
  }
  if (selector && typeof selector === "string") {
    logger.info(`waiting selector start：${selector}`);

    const el = await page.waitForSelector(selector, {
      visible: true,
    });
    logger.info(`waiting selector end：${selector}`);
    if (!el) {
      throw new Error("selector not found");
    }
    let buffer: string | Buffer;
    if (type === "pdf") {
      logger.info(`generate pdf buffer start`);
      buffer = await page.pdf({
        printBackground: true,
        format: "a4",
      } as PDFOptions);
    } else {
      logger.info(`generate screenshot buffer start`);
      buffer = await el.screenshot({
        omitBackground: true,
      });
    }
    await page.close();
    logger.info(`generate buffer end`);
    return buffer as Buffer;
  } else {
    let buffer: string | Buffer;
    if (type === "pdf") {
      logger.info(`generate pdf buffer start`);
      buffer = await page.pdf({
        printBackground: true,
        format: "a4",
      } as PDFOptions);
    } else {
      logger.info(`generate screenshot buffer start`);
      buffer = await page.screenshot({
        fullPage: true,
        omitBackground: true,
      });
    }
    await page.close();
    logger.info(`generate buffer end`);
    return buffer as Buffer;
  }
}

// error
process.on("unhandledRejection", (error) => {
  errorLogger.error(`unhandledRejection`, error);
});
process.on("beforeExit", (code) => {
  errorLogger.error("beforeExit " + code + ", start close all chromium.");
  for (const b of global.ChromiumInstPool) {
    b.close().catch(() => {});
  }
});
process.on("exit", (code) => {
  errorLogger.error("exit " + code);
});

logger.info("init all global config ------ start......");
global.restarting = false;
global.screenshoting = false;
global.ChromiumInstPool = [];
global.ServerStartTime = Date.now();
global.queue = queue(async (c) => {
  const ctx = c.ctx;
  if (ctx.request.socket.destroyed) {
    logger.error("socket destroyed, task cancel");
    return;
  }
  const params = c.params;
  try {
    await waitRestarting();
    global.screenshoting = true;
    const buffer = await getScreenshot(params);
    if (Buffer.isBuffer(buffer)) {
      if (params.type === "pdf") {
        ctx.set(
          "Content-disposition",
          `attachment; filename=${config.defaultOutName}.pdf`
        );
        ctx.set("Content-Type", "application/pdf");
      } else {
        ctx.set(
          "Content-disposition",
          `attachment; filename=${config.defaultOutName}.png`
        );
        ctx.set("Content-Type", "image/png");
      }
      ctx.body = buffer;
    } else {
      ctx.status = 500;
      ctx.body = `internal error`;
    }
  } catch (e) {
    ctx.status = 500;
    ctx.body = "internal error";
    errorLogger.error("internal error", params, e);
    throw e;
  } finally {
  }
}, config.maxQueue);
global.queue.drain(() => {
  logger.info("all task done!");
  global.screenshoting = false;
});
global.rateLimitMap = new Map();

await startChromiums()
  .then(() => {
    logger.info("chromium start success!");
  })
  .catch((e) => {
    console.error("chromium start failed:", e);
    logger.error("chromium start failed:", e);
    process.exit(1);
  });

logger.info("init all global config ------ end......");

global.app = new Koa();
const router = new Router();
global.app.use(
  rateLimit({
    driver: "memory",
    db: global.rateLimitMap,
    duration: 60 * 1000,
    errorMessage: "please slow",
    id: (ctx) => ctx.ip,
    headers: {
      remaining: "Rate-Limit-Remaining",
      reset: "Rate-Limit-Reset",
      total: "Rate-Limit-Total",
    },
    max: config.maxRateLimit,
    disableHeader: false,
  })
);
global.app.use(bodyParser());
global.app.use(router.routes()).use(router.allowedMethods());

router.all("/api/screenshot", async (ctx) => {
  const params = ctx.request.body as getScreenshotArguments;
  const checker = checkArguments(params);
  if (checker.hasError) {
    ctx.status = 400;
    ctx.body = checker.message;
    return;
  }
  logger.info(`enqueue task: ${ctx.url}`);
  await global.queue.push({ params, ctx } as any);
});

const checkTimeInterval = 1000 * 30; //per 30s check

async function restartInstances() {
  // timeout
  if (
    Date.now() - global.ServerStartTime >
      config.restartChromeInstanceGutterTime &&
    global.ChromiumInstPool.length > 0
  ) {
    logger.info("will restart all instances......");
    if (global.screenshoting || global.queue.length() > 0) {
      logger.info("delay restart all instances......");
      return;
    }
    logger.info("restart all instances......");
    global.restarting = true;
    for (let i = 0; i < global.ChromiumInstPool.length; i++) {
      try {
        await global.ChromiumInstPool[i].close();
      } catch (error) {
        errorLogger.error("restart error: ", error);
      }
    }
    global.ChromiumInstPool = [];
    await startChromiums();
    global.ServerStartTime = Date.now();
    global.restarting = false;
    logger.info("restart completed");
  }
  setTimeout(restartInstances, checkTimeInterval);
}

global.app.listen(config.port, () => {
  restartInstances().catch((e) => {
    errorLogger.error("restart fail", e);
  });
  console.log("server start completed, port: " + config.port);
  console.log("timeout(s)：" + config.timeout);
  console.log("chromium nums：" + config.ChromiumInstPoolSize);
  console.log("maxQueue：" + config.maxQueue);
  console.log("max request per minute：" + config.maxRateLimit);
  console.log("restart cycle(s)：" + config.restartChromeInstanceGutterTime);
});
