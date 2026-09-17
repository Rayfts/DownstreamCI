import { api } from "fixture-npm-lib";
if (api() !== "stable") {
  console.error(`expected stable, received ${api()}`);
  process.exit(1);
}
