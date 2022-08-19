# Release Process
**this is a living document and should be updated as new steps are discovered**

1. Checkout main branch
2. Pull down most recent changes to main
3. Run `pnpm update` to see if there are any new dependency updates.  (And then install any new version of depdencies)
4. Run rm -fr node_modules to clean your node_modules folder
5. Run `npm install` to make sure we are installing with the latest
6. Run `npm run format` to make sure everything is using the correct format.  Sometimes code can be merged without being formatted first. Or sometimes the formatting rules change after a code merge.
7. Run `npm run build` to get the newest build in the dist folder.  (Running npm run dev might not re-build until code is changed)
8. Run npm run dev, go to chrome, open up dev tools console, and navigate manually to each test in the test folder (and subfolders).  If you want to be thorough and check tiling tests, you can run `npm run tiler` and check the tiler tests.
9. Run npm run build again (just in case)
10. Run `npx pkg-ok` to make sure there aren't files in your package.json files property array that don't exist
11. Run `np` to publish a new version (https://github.com/sindresorhus/np)
