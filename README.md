# companion-module-mxu-slides

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE)

## Getting started

Executing a `yarn` command should perform all necessary steps to develop the module, if it does not then follow the steps below.

The module can be built once with `yarn build`. This should be enough to get the module to be loadable by companion.

While developing the module, by using `yarn dev` the compiler will be run in watch mode to recompile the files on change.

## Tests

`src/__tests__` holds the unit tests and a stand-in for MxU Slides that speaks its Local API. They use Node's own test runner, so there is nothing extra to install:

```
yarn tsc -p tsconfig.json
node --test --test-concurrency=1 "dist/__tests__/*.spec.js"
```

`yarn build` clears `dist` again before a package is made.

The stand-in also runs by itself, for trying the module in Companion without MxU Slides:

```
node dist/__tests__/fake-slides-cli.js --port 6991 --demo
```
