import type { Probot } from "probot";
import { createHandler } from "./handler.js";

export default (app: Probot) => {
  app.on(
    ["pull_request.opened", "pull_request.edited", "pull_request.synchronize", "pull_request.reopened"],
    createHandler(app),
  );
};
