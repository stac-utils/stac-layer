// wraps a function or promise in a timeout
export default function withTimeout(ms, promiseOrFunction) {
  return new Promise((resolve, reject) => {
    let timeout = setTimeout(() => reject("timed out"), ms);
    let promise;
    if ("then" in promiseOrFunction) {
      promise = promiseOrFunction;
    } else {
      promise = Promise.resolve(promiseOrFunction());
    }
    promise
      .then(result => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

await withTimeout(1000, () => {});
