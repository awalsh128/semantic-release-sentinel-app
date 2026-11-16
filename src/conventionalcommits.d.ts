declare module "conventional-changelog-conventionalcommits" {
  /** Only the part of the preset this app uses: the commit parser options. */
  export default function createPreset(config?: object): Promise<{ parser: object }>;
}
