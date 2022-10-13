import { Provide } from "@midwayjs/decorator";

@Provide()
export class MockService {

  async mock() {

  }

  async getMockRule(ruleId: string) {

    return null
  }
}