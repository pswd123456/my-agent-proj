import { describe } from "bun:test";

import { createMemoryBackgroundTaskRepository } from "../src/background-task-repository.js";
import {
  registerBackgroundTaskRepositoryContractTests,
  type BackgroundTaskRepositoryTestHarness
} from "./background-task-repository-contract.js";
import {
  createPostgresTestBackgroundTaskRepository,
  hasPostgresTestDatabase
} from "./helpers/postgres-background-task-repository.js";

function createMemoryHarness(): BackgroundTaskRepositoryTestHarness {
  const repository = createMemoryBackgroundTaskRepository();
  return {
    repository,
    testId(suffix: string) {
      return `memory-${suffix}`;
    },
    async cleanup() {}
  };
}

registerBackgroundTaskRepositoryContractTests(
  "MemoryBackgroundTaskRepository",
  createMemoryHarness
);

const describePostgresContracts = hasPostgresTestDatabase
  ? describe
  : describe.skip;

describePostgresContracts("PostgresBackgroundTaskRepository", () => {
  registerBackgroundTaskRepositoryContractTests(
    "contract",
    createPostgresTestBackgroundTaskRepository
  );
});
