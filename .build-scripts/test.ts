import clui from 'clui'
import { glob } from 'glob'

var Progress = clui.Progress

async function test() {
  try {
    let path = 'D:/repo/app-api-proxy/node_modules/classic-level/build/*.sln'
    const files = await glob(path, {
      signal: AbortSignal.timeout(100),
    })
    console.log('files', files)
  } catch (error) {
    console.log(error)
  }
}

test()