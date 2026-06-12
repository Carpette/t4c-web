// formula-engine.js

import { Parser } from "expr-eval-fork";

export class FormulaEngine {
  constructor() {
    this.parser = new Parser();

    //
    // Fonctions math
    //
    this.parser.functions.floor = Math.floor;
    this.parser.functions.ceil = Math.ceil;
    this.parser.functions.round = Math.round;
    this.parser.functions.min = Math.min;
    this.parser.functions.max = Math.max;
    this.parser.functions.abs = Math.abs;
    this.parser.functions.sqrt = Math.sqrt;
    this.parser.functions.pow = Math.pow;

    //
    // RPG
    //
    this.parser.functions.dice = (count, faces) => {
      let total = 0;

      for (let i = 0; i < count; i++) {
        total += Math.floor(Math.random() * faces) + 1;
      }

      return total;
    };

    this.parser.functions.rand = (min, max) => {
      return Math.floor(
        Math.random() * (max - min + 1)
      ) + min;
    };

    this.parser.functions.clamp = (value, min, max) => {
      return Math.max(min, Math.min(max, value));
    };
  }

  /**
   * Transforme :
   * 1d9
   * 2d6
   * 3d4
   *
   * en :
   *
   * dice(1,9)
   * dice(2,6)
   * dice(3,4)
   */
  preprocess(formula) {
    return formula.replace(
      /(\d+)d(\d+)/gi,
      (_, count, faces) => `dice(${count},${faces})`
    );
  }

  compile(formula) {
    const processed = this.preprocess(formula);

    return this.parser.parse(processed);
  }

  evaluate(formula, context) {
    return this.compile(formula).evaluate(context);
  }
}