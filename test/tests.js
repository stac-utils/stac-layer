import open from 'open';
import { globSync } from 'glob';

const args = process.argv.slice(2);
const testFolders = ['item-collection', 'stac-api-items', 'stac-catalog', 'stac-item', 'stac-item-asset', 'tilers/marblecutter', 'tilers/titiler'];

const openInBrowser = args.includes("open");
const folder = args.find(arg => testFolders.includes(arg)) || '**';

const files = globSync(`test/${folder}/*.html`, {});
files.forEach(file => {
  file = file.replaceAll('\\', '/');
  let url = `http://localhost:8080/${file}`;
  if (openInBrowser) {
    open(url);
  }
  else {
    console.log(url);
  }
});