const eventHandlers = {
  loaded: [],
  fallback: [],
  click: [],
  imageLayerAdded: []
};
const queue = [];
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

export function logPromise(error) {
  return log(1, error);
}

export function registerEvents(layerGroup) {
  // hijack on event to support on("click") as it isn't normally supported by layer groups
  layerGroup.on2 = layerGroup.on;
  layerGroup.on = function (name, callback) {
    if (name in eventHandlers) {
      eventHandlers[name].push(callback);
      return this;
    } else if (this.on2) {
      return this.on2(...arguments);
    }
  };
}

export function flushEventQueue() {
  while (queue.length > 0) {
    let evt = queue.shift();
    triggerEvent(evt.name, evt.data);
  }
}

// some events are sent before the you can react on it
// make a queue and only trigger once added to map
export function triggerEvent(name, data, layerGroup = null) {
  // Layer has not been added to map yet, queue events for later
  if (layerGroup && layerGroup.orphan) {
    queue.push({ name, data });
    return;
  }
  eventHandlers[name].forEach(callback => {
    try {
      callback(data);
    } catch (error) {
      log(1, error);
    }
  });
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
        triggerEvent("fallback", { error: evt }, layerGroup);
      }
    });
  });
}

// sets up generic onClick event where a "stac" key is added to the event object
// and is set to the provided data or the data used to create stacLayer
export function bindDataToClickEvent(lyr, data) {
  lyr.on("click", evt => {
    if (typeof data === "function") {
      evt.stac = data(evt);
    } else {
      evt.stac = {
        data,
        type: data.getObjectType()
      };
    }
    triggerEvent("click", evt);
  });
}
