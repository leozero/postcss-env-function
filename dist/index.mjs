import { parse } from 'postcss-values-parser';
import fs from 'fs';
import path from 'path';

const dashedMatch = /^--/; // returns the value of a css function as a string

var getFnValue = (node => {
  const value = String(node.nodes);
  return dashedMatch.test(value) ? value : undefined;
});

var updateEnvValue = ((node, variables) => {
  // get the value of a css function as a string
  const value = getFnValue(node);

  if (typeof value === 'string' && value in variables) {
    node.replaceWith(...asClonedArrayWithBeforeSpacing(variables[value], node.raws.before));
  }
}); // return an array with its nodes cloned, preserving the raw

const asClonedArrayWithBeforeSpacing = (array, beforeSpacing) => {
  const clonedArray = asClonedArray(array, null);

  if (clonedArray[0]) {
    clonedArray[0].raws.before = beforeSpacing;
  }

  return clonedArray;
}; // return an array with its nodes cloned


const asClonedArray = (array, parent) => array.map(node => asClonedNode(node, parent)); // return a cloned node


const asClonedNode = (node, parent) => {
  const cloneNode = new node.constructor(node);

  for (const key in node) {
    if (key === 'parent') {
      cloneNode.parent = parent;
    } else if (Object(node[key]).constructor === Array) {
      cloneNode[key] = asClonedArray(node.nodes, cloneNode);
    } else if (Object(node[key]).constructor === Object) {
      cloneNode[key] = Object.assign({}, node[key]);
    }
  }

  return cloneNode;
};

// returns whether a node is a css env() function
var isEnvFunc = (node => node && node.type === 'func' && node.name === 'env');

function walk(node, fn) {
  node.nodes.slice(0).forEach(childNode => {
    if (childNode.nodes) {
      walk(childNode, fn);
    }

    if (isEnvFunc(childNode)) {
      fn(childNode);
    }
  });
}

/**
 * @param {string} originalValue
 * @param variables
 * @returns {string} returns a value replaced with environment variables
 */

var getReplacedValue = ((originalValue, variables) => {
  // get the ast of the original value
  const ast = parse(originalValue); // walk all of the css env() functions

  walk(ast, node => {
    // update the environment value for the css env() function
    updateEnvValue(node, variables);
  }); // return the stringified ast

  return String(ast);
});

/**
 * Import Custom Properties from Object
 * @param {{environmentVariables: Record<string, string>, 'environment-variables': Record<string, string>}} object
 * @returns {Record<string, import('postcss-values-parser').Root>}
 */

function importEnvironmentVariablesFromObject(object) {
  const environmentVariables = Object.assign({}, Object(object).environmentVariables || Object(object)['environment-variables']);

  for (const key in environmentVariables) {
    environmentVariables[key] = parse(environmentVariables[key]).nodes;
  }

  return environmentVariables;
}
/**
 * Import Custom Properties from JSON file
 * @param {string} from
 * @returns {Promise<Record<string, import('postcss-values-parser').Root>>}
 */


async function importEnvironmentVariablesFromJSONFile(from) {
  const object = await readJSON(path.resolve(from));
  return importEnvironmentVariablesFromObject(object);
}
/**
 * Import Custom Properties from JS file
 * @param {string} from
 * @returns {Promise<Record<string, import('postcss-values-parser').Root>>}
 */


async function importEnvironmentVariablesFromJSFile(from) {
  const object = await import(path.resolve(from));
  return importEnvironmentVariablesFromObject(object);
}
/**
 * Import Custom Properties from Sources
 * @param {(string|Function|Promise|{type:string,environmentVariables: Record<string, string>, 'environment-variables': Record<string, string>})[]} sources
 * @returns {Promise<Record<string, import('postcss-values-parser').Root>>}
 */


function importEnvironmentVariablesFromSources(sources) {
  return sources.map(source => {
    if (source instanceof Promise) {
      return source;
    } else if (source instanceof Function) {
      return source();
    } // read the source as an object


    const opts = source === Object(source) ? source : {
      from: String(source)
    }; // skip objects with Custom Properties

    if (opts.environmentVariables || opts['environment-variables']) {
      return opts;
    } // source pathname


    const from = String(opts.from || ''); // type of file being read from

    const type = (opts.type || path.extname(from).slice(1)).toLowerCase();
    return {
      type,
      from
    };
  }).reduce(async (environmentVariables, source) => {
    const {
      type,
      from
    } = await source;

    if (type === 'js') {
      return Object.assign(environmentVariables, await importEnvironmentVariablesFromJSFile(from));
    }

    if (type === 'json') {
      return Object.assign(environmentVariables, await importEnvironmentVariablesFromJSONFile(from));
    }

    return Object.assign(environmentVariables, importEnvironmentVariablesFromObject(await source));
  }, {});
}
/* Helper utilities
/* ========================================================================== */

/**
 * @param {string} from
 * @returns {Promise<string>}
 */

const readFile = from => new Promise((resolve, reject) => {
  fs.readFile(from, 'utf8', (error, result) => {
    if (error) {
      reject(error);
    } else {
      resolve(result);
    }
  });
});

const readJSON = async from => JSON.parse(await readFile(from));

/**
 * @param {{importFrom?: string[]}} opts
 * @returns {import('postcss').Plugin}
 */

module.exports = function creator(opts) {
  // sources to import environment variables from
  const importFrom = [].concat(Object(opts).importFrom || []); // promise any environment variables are imported

  const environmentVariablesPromise = importEnvironmentVariablesFromSources(importFrom);
  return {
    postcssPlugin: 'postcss-env-fn',

    async AtRule(atRule) {
      const replacedValue = getReplacedValue(atRule.params, await environmentVariablesPromise);

      if (replacedValue !== atRule.params) {
        atRule.params = replacedValue;
      }
    },

    async Declaration(decl) {
      const replacedValue = getReplacedValue(decl.value, await environmentVariablesPromise);

      if (replacedValue !== decl.value) {
        decl.value = replacedValue;
      }
    }

  };
};

module.exports.postcss = true;
