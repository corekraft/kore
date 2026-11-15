// Entity provider: replaces its whole set on each refresh. A failed read
// applies nothing, so a transient API error never empties the catalog.
import { entitiesFor } from "./entities.js";

const KEY = "kore-platform-provider";

export function createProvider({ list, log }) {
  let connection;
  return {
    getProviderName: () => KEY,
    async connect(next) {
      connection = next;
    },
    async refresh() {
      if (!connection) {
        throw new Error("the provider is not connected to the catalog yet");
      }
      let objects;
      try {
        objects = await list();
      } catch (error) {
        log.warn(`catalog refresh skipped: ${error.message}`);
        return;
      }
      await connection.applyMutation({
        type: "full",
        entities: entitiesFor(objects).map((entity) => ({
          entity,
          locationKey: KEY,
        })),
      });
    },
  };
}
