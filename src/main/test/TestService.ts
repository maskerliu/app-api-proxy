import { Service } from "../common/decorators/webmvc.decorators";


@Service()
export default class TestService {

  test(name: string): string {
    return `hello ${name}`
  }
}