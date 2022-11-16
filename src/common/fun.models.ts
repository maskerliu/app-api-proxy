

export namespace Fun {

  export interface GameItem {
    _id: string,
    _rev: string,
    version?: string,
    author?: string,
    name?: string,
    desc?: string,
    icon?: string,
    snaps: Array<string>,
    url: string
  }
}