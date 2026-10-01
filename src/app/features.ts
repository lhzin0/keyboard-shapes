/**
 * Features that are switched off. Only the 2D views and the comparison are on.
 * Set a flag to true to bring a feature back; the code behind it is untouched.
 */
export const FEATURES: Record<'viewer3d' | 'build' | 'importer' | 'compatibility' | 'similar', boolean> = {
  viewer3d: false,
  build: false,
  importer: false,
  compatibility: false,
  similar: false,
};
