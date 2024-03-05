import { App } from "@winglang/platform-awscdk/lib/app.js";
import { type AppProps } from "@winglang/sdk/lib/core/app.js";

export class CustomApp extends App {
  constructor(props: AppProps) {
    super(props);
  }
}
