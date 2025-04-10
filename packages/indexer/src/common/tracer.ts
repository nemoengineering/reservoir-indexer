import tracer from "dd-trace";

import { getServiceName } from "@/config/service";
import { config } from "@/config/index";

if (process.env.DATADOG_AGENT_URL) {
  const service = getServiceName();

  tracer.init({
    profiling: false,
    logInjection: true,
    runtimeMetrics: false,
    clientIpEnabled: true,
    service,
    url: process.env.DATADOG_AGENT_URL,
    env: config.environment,
  });

  for (const disabledDatadogPluginTracing of config.disabledDatadogPluginsTracing) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    tracer.use(disabledDatadogPluginTracing, {
      enabled: false,
    });
  }

  tracer.use("hapi", {
    headers: ["x-api-key", "referer"],
    enabled: true,
  });
}

export default tracer;
