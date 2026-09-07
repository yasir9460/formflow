using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "crypto-test", worker = (
    modules = [(name = "test.mjs", esModule = embed "crypto-runtime.mjs")],
    compatibilityDate = "2026-05-15",
    compatibilityFlags = ["nodejs_compat"]
  ))]
);
