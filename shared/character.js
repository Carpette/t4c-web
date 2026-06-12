import { xpForLevel } from "./constants";

export class Stats {
  constructor(data) {
    this.strength = data.strength || 0;
    this.endurance = data.endurance || 0;
    this.dexterity = data.dexterity || 0;
    this.wisdom = data.wisdom || 0;
    this.intelligence = data.intelligence || 0;
    this.hp = data.hp || 0;
    this.max_hp = data.max_hp || 0;
    this.mana = data.mana || 0;
    this.max_mana = data.max_mana || 0;
  }
}

export class Skill {
    constructor(data) {
    }
}

export class Character {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.level = data.level;
    this.available_stat_points = data.available_stat_points;
    this.available_skill_points = data.available_skill_points;
    this.stats = new Stats(data.stats);
    this.buff_stats = new Stats(data.buff_stats || {});
    this.skills = data.skills;
    this.xp = data.xp;
    this.encumbrance = data.encumbrance || 0;
    
    this.buff_stats = data.buff_stats || {};
    this.buff_power = data.buff_power || {};
  }

  gainXp(amount) {
    this.xp += amount;

    if( xpForLevel(this.level + 1) <= this.xp ) {
        this._levelup();
    }
  }
  _levelup(){
    this.level++;
    this.available_stat_points += 5;
    this.available_skill_points += 15;
  }
}