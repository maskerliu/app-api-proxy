
import { Service } from 'lynx-express-mvc'

@Service()
export default class TestService {

  test(name: string): string {
    return `hello ${name}`
  }
}