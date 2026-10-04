/**
 * The published version of this package, sent with every request.
 *
 * Kept as a literal rather than read from package.json: this file is bundled
 * into a customer's binary, where there is no package.json to read, and a JSON
 * import would make the ESM output depend on the bundler's assertion support.
 * A test keeps it honest against package.json.
 */
export const SDK_VERSION = '0.4.0'
