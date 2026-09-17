import { api } from "fixture-npm-lib";
if (api() !== "never-valid") {
  console.error(`intentional baseline failure: ${api()}`);
  process.exit(1);
}
