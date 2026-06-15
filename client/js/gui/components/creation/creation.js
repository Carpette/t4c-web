import { globalBus } from '../../../event-bus.js';

export function CreationController() {
  const ctrl = {
    info: null,
    alloc: {},
    left: 0,
    sex: 'male',
    
    init() {
      globalBus.on('gui:show-creation', (info) => {
        this.info = info;
        for (const st of info.stats) this.alloc[st] = info.base;
        this.left = info.pool;
        this.sex = 'male';
      });
    },

    get pointsLeftText() {
        return this.left > 0 ? `Points restants : ${this.left}` : 'Tous les points sont répartis.';
    },

    canConfirm() {
        return this.left === 0;
    },

    setSex(sex) {
        this.sex = sex;
    },

    incrementStat(stat) {
        if (this.left > 0 && this.alloc[stat] < this.info.max) {
            this.alloc[stat]++;
            this.left--;
        }
    },

    decrementStat(stat) {
        if (this.alloc[stat] > this.info.base) {
            this.alloc[stat]--;
            this.left++;
        }
    },

    confirm() {
        if (!this.canConfirm()) return;
        globalBus.emit('ui:send-packet', { t: 'create', stats: this.alloc, sex: this.sex });
    }
  };

  return ctrl;
}
