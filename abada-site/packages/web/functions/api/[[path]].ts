import app from "../../src/api";

export const onRequest = async (context) => {
  return app.fetch(context.request, context.env, context);
};
