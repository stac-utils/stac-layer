const onClickHandlers = [];
const onFallbackHandlers = [];
let logLevel = 0;

export function enableLogging(level) {
  logLevel = typeof level === "number" && level > 0 ? level : 0;
}

export function log(level, ...args) {
  if (logLevel >= level) {
    let method = args.some(e => e instanceof Error) ? "error" : "log";
    console[method]("[stac-layer]", ...args);
  }
}

// hijack on event to support on("click") as it isn't normally supported by layer groups
export function registerEvents(layerGroup) {
  layerGroup.on2 = layerGroup.on;
  layerGroup.on = function (name, callback) {
    if (name === "click") {
      onClickHandlers.push(callback);
      return this;
    } else if (name === "fallback") {
      onFallbackHandlers.push(callback);
      return this;
    } else if (this.on2) {
      return this.on2(...arguments);
    }
  };
}

// if the given layer fails for any reason, remove it from the map, and call the fallback
export function setFallback(lyr, layerGroup, fallback) {
  // todo: doesn't work yet?
  let count = 0;
  ["tileerror"].forEach(name => {
    lyr.on(name, async evt => {
      count++;
      // sometimes LeafletJS might issue multiple error events before
      // the layer is removed from the map
      // the following makes sure we only active the fallback sequence once
      if (count === 1) {
        log(1, `activating fallback because "${evt.error.message}"`);
        if (layerGroup.hasLayer(lyr)) layerGroup.removeLayer(lyr);
        await fallback();
        onFallbackHandlers.forEach(handleOnFallback => {
          try {
            handleOnFallback({ error: evt });
          } catch (error) {
            log(1, error);
          }
        });
      }
    });
  });
}

// sets up generic onClick event where a "stac" key is added to the event object
// and is set to the provided data or the data used to create stacLayer
export function bindDataToClickEvent(lyr, what) {
  lyr.on("click", evt => {
    let data = typeof what === "function" ? what(evt) : what;
    evt.stac = {
      data,
      type: data.getObjectType()
    };
    onClickHandlers.forEach(handleOnClick => {
      try {
        handleOnClick(evt);
      } catch (error) {
        log(1, error);
      }
    });
  });
}
