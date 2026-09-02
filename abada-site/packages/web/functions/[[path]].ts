import { app } from "../../src/api";

export default {
  fetch: (request: Request, env: unknown, ctx: unknown) =>
    app.fetch(request, env, ctx),
};
