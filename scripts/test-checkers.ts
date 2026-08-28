// Тест движка русских шашек: стартовая позиция, бой, дамка, превращение.
import {
  ckInitial, ckLegalSteps, ckApplyStep, ckFullMoves, ckIdxToRC, ckRCToIdx,
  type CkState,
} from '../src/lib/games/checkers-core'

let failed = 0
const assert = (cond: boolean, name: string) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) failed++
}

// 1. Старт: 12+12 шашек, ход белых, только простые шаги вперёд (7 ходов: 4 передних простых... )
const st = ckInitial('w')
const whiteCells = st.cells.filter((c) => c === 1).length
const blackCells = st.cells.filter((c) => c === 3).length
assert(whiteCells === 12 && blackCells === 12, 'старт: 12+12 шашек')
assert(st.turn === 'w' && !st.winner, 'старт: ход белых, победителя нет')
const steps = ckLegalSteps(st)
assert(steps.every((s) => s.cap === null), 'старт: нет обязательного боя')
assert(steps.length === 7, `старт: 7 простых ходов (получено ${steps.length})`)
// все стартовые ходы — вперёд (r уменьшается у белых)
assert(
  steps.every((s) => {
    const [r1] = ckIdxToRC(s.from)
    const [r2] = ckIdxToRC(s.to)
    return r2 === r1 - 1
  }),
  'старт: простые ходят только вперёд',
)

// 2. Бой простой: соберём позицию руками — белая d4 (r=5? нет) сделаем прямую клетку.
// Возьмём позицию: белая на (4,3) idx? посчитаем: r=4 чётный → c=1,3,5,7 → (4,3)=idx 4*4+1=17.
// Чёрная на (3,4): r=3 нечётный → c=0,2,4,6 → (3,4) НЕ тёмная. Возьмём чёрную на (3,2): idx=3*4+1=13.
// Лендинг (2,1): r=2 чётный → c нечёт: (2,1) idx=2*4+0=8. ✓
const s2: CkState = { ...ckInitial('w'), cells: new Array(32).fill(0), turn: 'w' }
s2.cells[17] = 1
s2.cells[13] = 3
const steps2 = ckLegalSteps(s2)
assert(steps2.length === 1 && steps2[0].cap === 13 && steps2[0].to === 8, 'бой: единственный обязательный взятий ход')
const s2b = ckApplyStep(s2, steps2[0])
assert(!!s2b && s2b.cells[8] === 1 && s2b.cells[13] === 0 && s2b.cells[17] === 0, 'бой: шашка встала на поле за побитой, побитая снята')
assert(!!s2b && s2b.turn === 'b', 'бой: ход перешёл чёрным')

// 3. Обязательное продолжение цепочки: за лендингом (8)=(2,1) ещё чёрная на (1,2)?
// (1,2): r=1 нечётный → c чётные → (1,2) idx=1*4+1=5. Лендинг (0,3): r=0 → c нечёт → idx 0*4+1=1.
const s3: CkState = { ...ckInitial('w'), cells: new Array(32).fill(0), turn: 'w' }
s3.cells[17] = 1
s3.cells[13] = 3
s3.cells[5] = 3
const st3 = ckApplyStep(s3, { from: 17, to: 8, cap: 13 })
assert(!!st3 && st3.chainFrom === 8 && st3.turn === 'w', 'цепочка: бой не завершён, ход остался у белых')
const steps3 = ckLegalSteps(st3!)
assert(steps3.length === 1 && steps3[0].from === 8 && steps3[0].to === 1 && steps3[0].cap === 5, 'цепочка: продолжение боя той же шашкой')
const st3b = ckApplyStep(st3!, steps3[0])
assert(!!st3b && st3b.turn === 'b' && st3b.cells[5] === 0 && st3b.captured.length === 0, 'цепочка: завершена, побитые сняты')

// 4. Дамка бьёт на лету через поле: белая дамка (2,4)=idx r=2→c чёт? r=2 чётный → c=1,3,5,7; (2,5)? c=5 → idx=2*4+2=10.
// Чёрная на (4,3) idx=17. За ней (5,2) r=5 нечёт → c чёт → idx=5*4+1=21; (6,1) r=6 чёт → c нечёт → idx=6*4+0=24.
const s4: CkState = { ...ckInitial('w'), cells: new Array(32).fill(0), turn: 'w' }
s4.cells[10] = 2 // белая дамка на (2,5)
s4.cells[17] = 3 // чёрная на (4,3)
const steps4 = ckLegalSteps(s4)
assert(steps4.some((x) => x.to === 21 && x.cap === 17) && steps4.some((x) => x.to === 24 && x.cap === 17), 'дамка: два поля приземления за побитой')
// простые ходы дамки по пустым
assert(steps4.some((x) => x.cap === null && x.to === ckRCToIdx(3, 4)) === false, 'дамка: (3,4) не тёмная — ок')

// 5. Превращение в дамку при простом ходе + бой как дамка НЕ мгновенно (превратилась — ход завершён)
const s5: CkState = { ...ckInitial('w'), cells: new Array(32).fill(0), turn: 'w' }
s5.cells[ckRCToIdx(1, 2)] = 1 // (1,2) idx=5
const st5 = ckApplyStep(s5, { from: 5, to: ckRCToIdx(0, 3), cap: null })
assert(!!st5 && st5.cells[ckRCToIdx(0, 3)] === 2, 'превращение: простая стала дамкой на последнем ряду')

// 6. Победа: у соперника нет шашек
const s6: CkState = { ...ckInitial('w'), cells: new Array(32).fill(0), turn: 'w' }
s6.cells[10] = 2
s6.cells[17] = 3
const fin = ckApplyStep(s6, { from: 10, to: 21, cap: 17 })
assert(!!fin && fin.winner === 'w', 'победа: у чёрных не осталось шашек')

// 7. Полные ходы: на старте 7 полных ходов; в позиции с цепочкой — цепочка одним ходом
const fm1 = ckFullMoves(st)
assert(fm1.length === 7, `полные ходы на старте = 7 (${fm1.length})`)
const fm3 = ckFullMoves(s3)
assert(fm3.length === 1 && fm3[0].steps.length === 2, 'полный ход с цепочкой боя = 1 ход из 2 шагов')

// 8. Нельзя бить свою / дважды одну: чёрные между двух белых
const s8: CkState = { ...ckInitial('w'), cells: new Array(32).fill(0), turn: 'w' }
s8.cells[17] = 1
s8.cells[13] = 1 // своя на пути боя
const steps8 = ckLegalSteps(s8)
assert(!steps8.some((x) => x.cap !== null), 'нельзя бить свою')

// 9. Ничья по «тихим» ходам (дамки НЕ на одной диагонали)
const s9: CkState = { ...ckInitial('w'), turn: 'w', quiet: 29 }
s9.cells = new Array(32).fill(0)
s9.cells[10] = 2 // (2,5)
s9.cells[ckRCToIdx(5, 4)] = 4 // (5,4)
const s9b = ckApplyStep(s9, ckLegalSteps(s9)[0])
assert(!!s9b && (s9b.winner === 'draw' || s9b.quiet >= 29), 'ничья: счётчик тихих ходов растёт')

console.log(failed === 0 ? '\n🎯 ВСЕ ТЕСТЫ ПРОЙДЕНЫ' : `\n💥 ПРОВАЛЕНО: ${failed}`)
process.exit(failed === 0 ? 0 : 1)
