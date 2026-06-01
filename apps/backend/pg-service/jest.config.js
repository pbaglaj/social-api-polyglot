export default {
  preset: 'ts-jest',
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          ignoreDeprecations: "6.0",
          module: "esnext",
          moduleResolution: "node",
        },
      },
    ],
  },
};