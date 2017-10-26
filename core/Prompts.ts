import { Routable, Router, Recognizer, Observableable } from './Router';

export class NamedRouter <ARGS extends object, M extends Routable> {
    private static registry: {
        [name: string]: (args: any) => Router<any>;
    } = {}

    constructor(
        name: string,
        public getRouter: (args?: ARGS) => Router<M>,
        redefine = false
    ) {
        if (NamedRouter.registry[name] && !redefine) {
            console.warn(`You tried to redefine a Named Router named ${name} without setting the "redefine" flag. This attempt was ignored.`);
            return;
        }

        NamedRouter.registry[name] = getRouter;
    }

    static getRouter(name: string, args: any) {
        const getRouter = NamedRouter.registry[name];
        return getRouter && getRouter(args);
    }
}

export interface PromptArgs<WITHARGS, RECOGNIZERARGS> {
    recognizerArgs: RECOGNIZERARGS;
    withArgs: WITHARGS;
    turn: number;
}

export interface PromptThenArgs<RESULT, WITHARGS, RECOGNIZERARGS> extends PromptArgs<WITHARGS, RECOGNIZERARGS> {
    result: RESULT;
}

export interface PromptElseArgs<WITHARGS, RECOGNIZERARGS> extends PromptArgs<WITHARGS, RECOGNIZERARGS> {
    reason: string;
}

export class PromptThen <WITHARGS, RECOGNIZERARGS, RESULT, M extends Routable> extends NamedRouter<PromptArgs<WITHARGS, RECOGNIZERARGS>, M> {
    constructor(
        private name: string,
        private recognizer: Recognizer<M, RECOGNIZERARGS, RESULT>,
        private getThenRouter: (promptThenArgs: PromptThenArgs<RESULT, WITHARGS, RECOGNIZERARGS>) => Router<M>
    ) {
        super (name,
            promptArgs => recognizer(promptArgs.recognizerArgs)
                .thenTry(result => getThenRouter({
                    ... promptArgs,
                    result
                }))
                .elseTry(reason => this.defaultPromptElseRouter({
                    ... promptArgs,
                    reason
                }))
        );
    }

    private defaultPromptElseRouter(promptElseArgs: PromptElseArgs<WITHARGS, RECOGNIZERARGS>): Router<M> {
        // default retry logic goes here
        return Router.do(c => console.log("I should probably retry or something"));
    }

    elseDo(promptElseHandler: (m: M, promptElseArgs: PromptElseArgs<WITHARGS, RECOGNIZERARGS>) => Observableable<any>) {
        return this.elseTry(promptElseArgs => Router.do(m => promptElseHandler(m, promptElseArgs)));
    }

    elseTry(promptElseRouter: Router<M>): NamedRouter<PromptElseArgs<WITHARGS, RECOGNIZERARGS>, M>;        
    elseTry(getPromptElseRouter: (promptElseArgs: PromptElseArgs<WITHARGS, RECOGNIZERARGS>) => Router<M>): NamedRouter<PromptArgs<WITHARGS, RECOGNIZERARGS>, M>;
    elseTry(arg) {
        const getPromptElseRouter = typeof(arg) === 'function'
            ? arg
            : (promptElseArgs: PromptElseArgs<WITHARGS, RECOGNIZERARGS>) => arg;

        return new NamedRouter<PromptArgs<WITHARGS, RECOGNIZERARGS>, M>(this.name,
            promptArgs => this.recognizer(promptArgs.recognizerArgs)
                .thenTry(result => this.getThenRouter({
                    ... promptArgs,
                    result
                }))
                .elseTry(reason => getPromptElseRouter({
                    ... promptArgs,
                    reason
                })),
            true
        );
    }
}

export class PromptRecognizer <WITHARGS, RECOGNIZERARGS, RESULT, M extends Routable> {
    constructor(
        private name: string,
        private recognizer: Recognizer<M, RECOGNIZERARGS, RESULT>
    ) {
    }

    thenDo(promptThenHandler: (m: M, promptThenArgs: PromptThenArgs<RESULT, WITHARGS, RECOGNIZERARGS>) => Observableable<any>) {
        return new PromptThen<WITHARGS, RECOGNIZERARGS, RESULT, M>(this.name, this.recognizer, promptThenArgs => Router.do(m => promptThenHandler(m, promptThenArgs))); 
    }

    thenTry(promptThenRouter: Router<M>): PromptThen<WITHARGS, RECOGNIZERARGS, RESULT, M>;
    thenTry(getPromptThenRouter: (promptThenArgs: PromptThenArgs<RESULT, WITHARGS, RECOGNIZERARGS>) => Router<M>): PromptThen<WITHARGS, RECOGNIZERARGS, RESULT, M>;
    thenTry(arg) {
        return new PromptThen<WITHARGS, RECOGNIZERARGS, RESULT, M>(this.name, this.recognizer, typeof arg === 'function'
            ? arg
            : result => arg
        );
    }
}

export class Prompt <WITHARGS extends object = any, M extends object = any> {
    constructor(
        private name: string,
    ) {
    }

    validate <ARG, RESULT> (recognizer: Recognizer<M, ARG, RESULT>) {
        return new PromptRecognizer<WITHARGS, ARG, RESULT, M>(this.name, recognizer);
    }
}
