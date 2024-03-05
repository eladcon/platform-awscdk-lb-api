import { CustomApi } from "./api";

import {
  API_FQN,
} from "@winglang/sdk/lib/cloud";
import type { IPlatform } from "@winglang/sdk/lib/platform";
import type { Construct } from "constructs";
import { App, type AppProps } from "@winglang/sdk/lib/core/app.js";
import { CustomApp } from "./app";

export class Platform implements IPlatform {
  public readonly target = "awscdk";

  newApp(appProps: AppProps): App {
    return new CustomApp(appProps);
  }

  public newInstance(
    type: string,
    scope: Construct,
    id: string,
    props: any,
  ): any {
    if (type === API_FQN) {
      return new CustomApi(scope, id, props);
    }
  }
}