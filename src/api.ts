import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as targets from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

import {
  Api,
  Endpoint,
  type ApiConnectOptions,
  type ApiDeleteOptions,
  type ApiGetOptions,
  type ApiHeadOptions,
  type ApiOptionsOptions,
  type ApiPatchOptions,
  type ApiPostOptions,
  type ApiProps,
  type ApiPutOptions,
  type IApiEndpointHandler,
} from "@winglang/sdk/lib/cloud";
import { App } from "@winglang/sdk/lib/core";
import { convertBetweenHandlers } from "@winglang/sdk/lib/shared/convert.js";
import {
  type NameOptions,
} from "@winglang/sdk/lib/shared/resource-names.js";
import { Function } from "@winglang/platform-awscdk/lib/function.js";
import type { Construct } from "constructs";

export class CustomApi extends Api {
  NAME_OPTS: NameOptions = {
    // eslint-disable-next-line unicorn/better-regex
    disallowedRegex: /[^a-zA-Z0-9\_\-]+/g,
  };

  handlers: Record<string, Record<string, IApiEndpointHandler>> = {};
  handlersLines: string[] = [];
  endpoint: Endpoint;
  listenerHTTP: elbv2.ApplicationListener
  constructor(scope: Construct, id: string, props: ApiProps = {}) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
    });

    const lb = new elbv2.ApplicationLoadBalancer(this, "LB", {
      vpc,
      internetFacing: true,
    });

    this.listenerHTTP = lb.addListener("HTTPListener", {
      port: 80,
    });

    this.listenerHTTP.addAction(`HTTPListenerAction`, {
      action: elbv2.ListenerAction.fixedResponse(404),
    });
    
    const cloudfrontDistribution = new cf.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: new origins.HttpOrigin(lb.loadBalancerDnsName, {
          protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cf.AllowedMethods.ALLOW_ALL,
        cachedMethods: cf.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cf.CachePolicy.CACHING_DISABLED,
      },
    });

    this.endpoint = new Endpoint(
      this,
      "Endpoint",
      `https://${cloudfrontDistribution.distributionDomainName}`,
      {
        label: `Api ${this.node.path}`,
      },
    );
  }

  protected get _endpoint(): Endpoint {
    return this.endpoint;
  }

  public get(
    path: string,
    inflight: IApiEndpointHandler,
    props?: ApiGetOptions,
  ): void {
    this.httpRequests("GET", path, inflight, props);
  }

  public post(
    path: string,
    inflight: IApiEndpointHandler,
    props?: ApiPostOptions,
  ): void {
    this.httpRequests("POST", path, inflight, props);
  }

  public put(
    path: string,
    inflight: IApiEndpointHandler,
    props?: ApiPutOptions,
  ): void {
    this.httpRequests("PUT", path, inflight, props);
  }

  public delete(
    path: string,
    inflight: IApiEndpointHandler,
    props?: ApiDeleteOptions,
  ): void {
    this.httpRequests("DELETE", path, inflight, props);
  }

  public patch(
    path: string,
    inflight: IApiEndpointHandler,
    props?: ApiPatchOptions,
  ): void {
    this.httpRequests("PATCH", path, inflight, props);
  }

  public options(
    path: string,
    inflight: IApiEndpointHandler,
    props?: ApiOptionsOptions,
  ): void {
    this.httpRequests("OPTIONS", path, inflight, props);
  }

  public head(
    path: string,
    inflight: IApiEndpointHandler,
    props?: ApiHeadOptions,
  ): void {
    this.httpRequests("HEAD", path, inflight, props);
  }

  public connect(
    path: string,
    inflight: IApiEndpointHandler,
    props?: ApiConnectOptions,
  ): void {
    this.httpRequests("CONNECT", path, inflight, props);
  }

  private httpRequests(
    method: string,
    path: string,
    inflight: IApiEndpointHandler,
    props?: ApiGetOptions,
  ): void {
    const lowerMethod = method.toLowerCase();
    const upperMethod = method.toUpperCase();

    if (props) {
      console.warn(`Api.${lowerMethod} does not support props yet`);
    }
    const pathParams = path.match(/:([A-Za-z0-9_-]+)/g);
    if (pathParams && pathParams.length > 0) {
      throw "Path parameters are not supported yet."
    }

    this._validatePath(path);
    this._addToSpec(path, method, undefined, this.corsOptions);

    if (!this.handlers[path]) {
      this.handlers[path] = {};
    }
    this.handlers[path]![method] = inflight;
  }

  public _preSynthesize(): void {
    super._preSynthesize();
    
    let priority = Math.floor(Math.random() * 1000) + 10;
    for (const path of Object.keys(this.handlers).sort().reverse()) {
      const handlers = this.handlers[path]!;
      for (const [method, handler] of Object.entries(handlers)) {
        const newInflight = convertBetweenHandlers(
          handler,
          // eslint-disable-next-line unicorn/prefer-module
          require.resolve(
            "@winglang/sdk/lib/shared-aws/api.onrequest.inflight.js",
          ),
          "ApiOnRequestHandlerClient",
          {
            corsHeaders: this._generateCorsHeaders(this.corsOptions)
              ?.defaultResponse,
          },
        );
  
        const prefix = `${method.toLowerCase()}${path.replace(/\//g, "_")}_}`;
        const func = new Function(
          this,
          App.of(this).makeId(this, prefix),
          newInflight
        );
        func._preSynthesize();

        this.listenerHTTP.addTargets(`HTTPListenerTargets-${prefix}`, {
          targets: [new targets.LambdaTarget(func._function)],
          healthCheck: {
            enabled: true,
          },
          conditions: [
            elbv2.ListenerCondition.pathPatterns([path]),
            elbv2.ListenerCondition.httpRequestMethods([method]),            
          ],
          priority: priority++,
        });
      }
    }
  }
}