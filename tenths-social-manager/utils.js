const { promisify } = require('util');
const execAsync = promisify(require('child_process').exec);
module.exports = { execAsync };
