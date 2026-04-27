export default {
  testEnvironment: "node",
  // Tell Jest to treat TypeScript files as ES Modules
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    // Configure ts-jest to use ESM
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
};