// @ts-nocheck

import TelegramBot from 'node-telegram-bot-api';
import { LocalStorage } from 'node-localstorage';
import createMachine from './state-machine';
import momentDurationFormatSetup from 'moment-duration-format';
import moment from 'moment';
import { Box } from 'tcharts.js';

momentDurationFormatSetup(moment);

const localStorage = new LocalStorage('./scratch');


const MS_IN_SECONDS = 1000;
const REFRESH_MS_IDLE = 30000;
const REFRESH_MS_WORK = 1000;
const REFRESH_MS_REST = 1000;

const token = process.env.FLOWTIME_BOT_TOKEN;

const restProcent = 25;

if(!token) {
  console.error('no token in env FLOWTIME_BOT_TOKEN')
  process.exit(0);
}

const controller = new AbortController();

const delay = (ms: number) => new Promise((resolve, reject) => {
  setTimeout(resolve, ms);
  controller.signal.addEventListener('abort', () => {
    reject('aborted timer');
  })
});


const stringify = (obj: any): string => JSON.stringify(obj, null, 2);
const parse = (str: string): any => JSON.parse(str);

const Store = (chatId: string) => {
  return {
    get: (keyname: string): any => {
      const obj = parse(localStorage.getItem(chatId));
      return obj && obj[keyname];
    },
    set: (keyname: string, value: any) => {
      const obj = parse(localStorage.getItem(chatId));
      localStorage.setItem(chatId, stringify({
        ...obj,
        [keyname]: value
      }));
      return value;
    }
  };
}

const bot = new TelegramBot(token, { polling: true });

const calculateRestTime = (timeFromStart: number): number => {
  const result = Math.round(timeFromStart * (restProcent / 100));
  return result;
}

const dur = (minutes) => moment.duration(minutes, 'seconds').format('h [hrs], m [min], s [sec]');

const singletones = {};

const init = (chatId: string) => {
    if (singletones[chatId]) {
        return singletones[chatId];
    }
    let restTimer = null;
    let workTimer = null;
    let idleTimer = null;
    const store = Store(chatId);
    const addDeposite = (keyName, value = 0) => {
        const today = moment().format('YYYY-MM-DD');
        const depositeStore = store.get('byDayStats') || {};
        if (!depositeStore[today]) {
            depositeStore[today] = {
              [keyName]: 0,
            };
        }
        if (!depositeStore[today][keyName]) {
            depositeStore[today][keyName] = 0;
        }
        depositeStore[today][keyName] += parseInt(depositeStore[today][keyName], 10) + parseInt(value, 10);
        store.set('byDayStats', depositeStore);
    }
    const getDeposite = (keyName: string) => {
        const today = moment().format('YYYY-MM-DD');
        const depositeStore = store.get('byDayStats') || {};
        return depositeStore[today][keyName] || 0;
    }
    const resetDeposite = () => {
        const today = moment().format('YYYY-MM-DD');
        const depositeStore = store.get('byDayStats') || {};
        if (depositeStore[today]) {
            depositeStore[today] = {
            };
        }
        store.set('byDayStats', depositeStore);
    }
    const workStatus = (context: any) => {
        const box = new Box(31, 8); // width, height
        box.setData([
          { name: 'work', value: getDeposite('workTime') },
          { name: 'rest', value: getDeposite('restTime') },
          { name: 'idle', value: getDeposite('idleTime') },
        ]);

        bot.sendMessage(context.chatId, `<code>${box.string()}</code>`, {
          parse_mode: 'HTML',
          "reply_markup": {
              "keyboard": [["start"], ["end"], ["status"]]
          }
        })
    }

    const machine = createMachine({
      initialState: 'rest',
      idle: {
        actions: {
          onEnter() {
            const idleStartTime = store.set('idleStartTime', moment());
            const msPromise = bot.sendMessage(chatId, `Idle start ${idleStartTime?.format('HH:mm')}`);
            msPromise.then((msg) => {
              let oldText = '';
              idleTimer = setInterval(() => {
                const now = moment();
                const rest = moment(now).diff(store.get('idleStartTime'), 'seconds');
                const messageText = `idle for ${dur(rest)}`
                if (messageText === oldText) {
                  return;
                }
                oldText = messageText;
                bot.editMessageText(messageText, {
                  chat_id: chatId,
                  message_id: msg.message_id
                });
              }, REFRESH_MS_IDLE);
            });
          },
          onExit() {
            const idleStartTime = store.get('idleStartTime') || moment();
            addDeposite('idleTime', moment().diff(idleStartTime, 'seconds'));
            addDeposite('idleCount', 1);
            clearInterval(idleTimer);
          },
        },
        transitions: {
          start: {
            target: 'work',
            action() {
              return true;
            }
          },
        },
      },
      work: {
        actions: {
          onEnter() {
            const startTime = store.set('startTime', moment());
            const msPromise = bot.sendMessage(chatId, `Start work from ${startTime?.format('HH:mm')}`);
            msPromise.then((msg) => {
              let oldText = '';
              workTimer = setInterval(() => {
                const now = moment();
                const rest = moment(now).diff(store.get('startTime'), 'seconds');
                const restDuration = calculateRestTime(rest);
                const messageText = `Working for ${dur(rest)}. Earned ${dur(restDuration)}`
                if (messageText === oldText) {
                  return;
                }
                oldText = messageText;
                bot.editMessageText(messageText, {
                  chat_id: chatId,
                  message_id: msg.message_id
                });
              }, REFRESH_MS_WORK);
            })
          },
          onExit() {
            clearTimeout(workTimer);
            const workStartTime = store.get('startTime') || moment();
            addDeposite('workTime', moment().diff(workStartTime, 'seconds'))
            addDeposite('workCount', 1);
          },
        },
        transitions: {
          end: {
            target: 'rest',
            action() {
              return true;
            },
          },
          idle: {
            target: 'idle',
            action() {
              return true;
            },
          },
        },
      },
      rest: {
        actions: {
          onEnter() {
            const now = moment();
            store.set('restStartTime', now);
            const timeFromStart = moment(now).diff(store.get('startTime'), 'seconds');
            const restDuration = calculateRestTime(timeFromStart);
            const restEndTime = store.set('restEndTime', now.add(restDuration, 'seconds'));
            const msPromise = bot.sendMessage(chatId, `You can rest ${dur(restDuration)} till ${restEndTime?.format('HH:mm')}`);
            msPromise.then((msg) => {
              let oldText = '';
              restTimer = setInterval(() => {
                const now = moment();
                const rest = moment(store.get('restEndTime')).diff(now, 'seconds');
                const messageText = `Rest time ${dur(rest)} left`;
                if (messageText === oldText) {
                  return;
                }
                oldText = messageText;
                bot.editMessageText(messageText, {
                  chat_id: chatId,
                  message_id: msg.message_id
                });
              }, REFRESH_MS_REST);
            });
            delay(restDuration * MS_IN_SECONDS).then(() => {
              bot.sendMessage(chatId, `The rest is over. You can work now from ${restEndTime?.format('HH:mm')}`);
              addDeposite('restCount', 1);
            }).catch(() => {
              bot.sendMessage(chatId, `The rest is over before finish time`);
            }).finally(() => {
              clearTimeout(restTimer);
              const state = machine.value;
              machine.transition(state, 'idle')
            });
          },
          onExit() {
            controller.abort();
            clearTimeout(restTimer);
            const restStartTime = store.get('restStartTime') || moment();
            addDeposite('restTime', moment().diff(restStartTime, 'seconds'))
            addDeposite('restCount', 1);
          },
        },
        transitions: {
          start: {
            target: 'work',
            action() {
              console.log('transition action for "start" in "rest" state')
              return true;
            },
          },
          idle: {
            target: 'idle',
            action() {
              return true;
            },
          },
        },
      },
    });
    singletones[chatId] = {
        machine,
        store,
        chatId,
        workStatus,
        resetDeposite,
    };
    return singletones[chatId];
}

bot.on('message', (msg?: any) => {
  const message = msg.text.toString().toLowerCase();
  const chatId = msg.chat.id;
  const context = init(chatId);

  if (message === 'start') {
      const state = context.machine.value;
      context.machine.transition(state, 'start')
  } else if (message === 'end') {
      const state = context.machine.value;
      context.machine.transition(state, 'end')
  } else if (message === 'idle') {
      const state = context.machine.value;
      context.machine.transition(state, 'idle')
  } else if (message === 'reset') {
    context.resetDeposite();
    bot.sendMessage(context.chatId, 'daily stats empty now');
  } else if (message === 'status') {
      context.workStatus(context);
  }

});

bot.on("polling_error", console.error);

