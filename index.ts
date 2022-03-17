// @ts-nocheck

import TelegramBot from 'node-telegram-bot-api';
import { LocalStorage } from 'node-localstorage';
import createMachine from './state-machine';
import momentDurationFormatSetup from 'moment-duration-format';
import moment from 'moment';

momentDurationFormatSetup(moment);

const localStorage = new LocalStorage('./scratch');


const MS_IN_MINUTES = 60 * 1000;
const REFRESH_MS = 2000;

const token = process.env.FLOWTIME_BOT_TOKEN;

const restProcent = 20;

if(!token) {
  console.error('no token in env FLWTIME_BOT_TOKEN')
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

const workStatus = (context: any) => {
    const state = context.machine.value;
    bot.sendMessage(context.chatId, `Status "${state}"`);
}

const dur = (minutes) => moment.duration(minutes, 'minutes').format('h [hrs], m [min]');

const singletones = {};

const init = (chatId: string) => {
    if (singletones[chatId]) {
        return singletones[chatId];
    }
    let restTimer = null;
    let workTimer = null;
    const store = Store(chatId);
    console.log('createMachine');
    const machine = createMachine({
      initialState: 'rest',
      work: {
        actions: {
          onEnter() {
            const startTime = store.set('startTime', moment());
            const msPromise = bot.sendMessage(chatId, `Start work from ${startTime?.format('HH:mm')}`);
            msPromise.then((msg) => {
              let oldText = '';
              workTimer = setInterval(() => {
                const now = moment();
                const rest = moment(now).diff(store.get('startTime'), 'minutes');
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
              }, REFRESH_MS);
            })
          },
          onExit() {
            clearTimeout(workTimer);
          },
        },
        transitions: {
          end: {
            target: 'rest',
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
            const timeFromStart = moment(now).diff(store.get('startTime'), 'minutes');
            const restDuration = calculateRestTime(timeFromStart);
            const restEndTime = store.set('restEndTime', now.add(restDuration, 'minutes'));
            const msPromise = bot.sendMessage(chatId, `You can rest ${dur(restDuration)} till ${restEndTime?.format('HH:mm')}`);
            msPromise.then((msg) => {
              let oldText = '';
              restTimer = setInterval(() => {
                const now = moment();
                const rest = moment(store.get('restEndTime')).diff(now, 'minutes');
                const messageText = `Rest time ${dur(rest)} left`;
                if (messageText === oldText) {
                  return;
                }
                oldText = messageText;
                bot.editMessageText(messageText, {
                  chat_id: chatId,
                  message_id: msg.message_id
                });
              }, REFRESH_MS);
            })
            delay(restDuration * MS_IN_MINUTES).then(() => {
              bot.sendMessage(chatId, `The rest is over. You can work now from ${restEndTime?.format('HH:mm')}`);
            }).catch(() => {
              bot.sendMessage(chatId, `The rest is over before finish time`);
            }).finally(() => {
              clearTimeout(restTimer);
            });
          },
          onExit() {
            controller.abort();
            clearTimeout(restTimer);
            console.log('rest: onExit')
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
        },
      },
    });
    singletones[chatId] = {
        machine,
        store,
        chatId
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
  } else if (message === 'status') {
      workStatus(context);
  }

});

bot.on("polling_error", console.error);
