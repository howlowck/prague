import { konsole } from './Konsole';
import { Observable } from 'rxjs';

export type Observableable <T> = T | Observable<T> | Promise<T>;

export function toObservable <T> (t: Observableable<T>) {
    if (t instanceof Observable)
        return t;
    if (t instanceof Promise)
        return Observable.fromPromise<T> (t);
    return Observable.of(t);
}

export function toFilteredObservable <T> (t: Observableable<T>) {
    if (!t)
        return Observable.empty<T>();
    if (t instanceof Observable)
        return t.filter(i => !!i);
    if (t instanceof Promise)
        return Observable.fromPromise<T> (t).filter(i => !!i);
    return Observable.of(t);
}

export interface Route {
    score?: number;
    thrown?: true;
    action: () => Observableable<any>;
}

export type Routable  = object;

export interface Handler <Z extends Routable> {
    (m: Z): Observableable<any>;
}

export class Router <M extends Routable> {
    constructor(public getRoute: (m: M) => Observable<Route>) {}

    static do <M extends Routable> (handler: Handler<M>) {
        return new Router<M>(m => Observable.of({
            action: () => handler(m)
        } as Route));
    }
    
    static null = new Router<any>(m => Observable.empty());

    route (m: M) {
        return this
            .getRoute(m)
            .do(route => konsole.log("route: returned a route", route))
            .flatMap(route => toObservable(route.action()))
            .do(_ => konsole.log("route: called action"));
    }

    beforeDo (handler: Handler<M>) {
        return new BeforeRouter<M>(handler, this);
    }

    afterDo (handler: Handler<M>) {
        return new AfterRouter<M>(handler, this);
    }

    defaultDo (handler: Handler<M>) {
        return this.defaultTry(Router.do(handler));
    }

    defaultTry (router: Router<M>) {
        return new DefaultRouter<M>(this, router);
    }

}

export class FirstRouter <M extends Routable> extends Router<M> {
    constructor (... routers: Router<M>[]) {
        super(m => Observable.from(routers)
            .concatMap((router, i) => {
                konsole.log(`first: trying router #${i}`);
                return router
                    .getRoute(m)
                    .do(n => konsole.log(`first: router #${i} succeeded`, n));
            })
            .take(1) // so that we don't keep going through routers after we find one that matches);
        );
    }
}

export function tryInOrder <M extends Routable> (... routers: Router<M>[]) {
    return new FirstRouter(... routers);
}

export function toScore (score: number) {
    return score == null ? 1 : score;
}

/*
export class BestRouter <M extends Routable> extends Router<M> {
    private static minRoute: Route = {
        score: 0,
        action: () => {
            console.warn("BestRouter.minRoute.action should never be called");
        }
    }
    
    constructor(... routersOrHandlers: RouterOrHandler<M>[]) {
        const router$ = Observable.from(Router.routersFrom(routersOrHandlers)); 
        super(m => new Observable<Route>(observer => {
            let bestRoute: Route = BestRouter.minRoute;

            const subscription = router$
                .takeWhile(_ => toScore(bestRoute.score) < 1)
                .concatMap(router => router.getRoute(m))
                .subscribe(
                    route => {
                        if (toScore(route.score) > toScore(bestRoute.score)) {
                            bestRoute = route;
                            if (toScore(bestRoute.score) === 1) {
                                observer.next(bestRoute);
                                observer.complete();
                            }
                        }
                    },
                    error =>
                        observer.error(error),
                    () => {
                        if (toScore(bestRoute.score) > 0)
                            observer.next(bestRoute);
                        observer.complete();
                    }
                );

            return () => subscription.unsubscribe();
        }));
    }
}

export function best <M extends Routable> (... routersOrHandlers: RouterOrHandler<M>[]) {
    return new BestRouter(... routersOrHandlers);
}
*/

export class RunRouter <M extends Routable> extends Router<M> {
    constructor(handler: Handler<M>) {
        super(m => toObservable(handler(m))
            .filter(_ => false)
        );
    }
}

export function run <M extends Routable> (handler: Handler<M>) {
    return new RunRouter(handler);
}

export interface Predicate <M extends Routable> {
    (m: M): Observableable<boolean>;
}

export class IfTrueElse <M extends Routable> extends Router<M> {
    constructor(
        private predicate: Predicate<M>,
        private thenRouter: Router<M>,
        private elseRouter: Router<M>
    ) {
        super(m => toObservable(predicate(m))
            .flatMap(result => result
                ? thenRouter.getRoute(m)
                : elseRouter.getRoute(m)
            )
        );
    }
}

export class IfTrueThen <M extends Routable> extends Router<M> {
    constructor(
        private predicate: Predicate<M>,
        private thenRouter: Router<M>
    ) {
        super(m => toFilteredObservable(predicate(m))
            .flatMap(_ => thenRouter.getRoute(m))
        );
    }

    elseDo(elseHandler: Handler<M>) {
        return this.elseTry(Router.do(elseHandler));
    }

    elseTry(elseRouter: Router<M>) {
        return new IfTrueElse(this.predicate, this.thenRouter, elseRouter)
    }
}

export class IfTrue <M extends Routable> {
    constructor (
        private predicate: Predicate<M>
    ) {
    }

    thenDo(thenHandler: Handler<M>) {
        return this.thenTry(Router.do(thenHandler));
    }

    thenTry(thenRouter: Router<M>) {
        return new IfTrueThen(this.predicate, thenRouter);
    }
}

export function ifTrue <M extends Routable> (
    predicate: Predicate<M>
): IfTrue<M> {
    return new IfTrue(predicate);
}

export interface Matcher <M extends Routable, RESULT> {
    (m: M): Observableable<MatcherResult<RESULT> | MatcherError | RESULT>;
}

export interface MatcherResult<RESULT> {
    result: RESULT;
    score?: number;
}

export interface MatcherError {
    error: string;
}

export type MatcherResultOrError<RESULT> = MatcherResult<RESULT> | MatcherError;

function isMatcherResult <RESULT> (matcherResultOrError: MatcherResultOrError<RESULT>): matcherResultOrError is MatcherResult<RESULT> {
    return (matcherResultOrError as any).result !== undefined;
}

function toMatcherResultOrError <RESULT> (response: any): MatcherResultOrError<RESULT> {
    if (!response)
        return {
            error: 'error'
        }

    if (typeof(response) === 'object' && (response.error || response.result))
        return response;

    return {
        result: response as RESULT
    }
}

function match <M extends Routable, RESULT> (matcher: Matcher<M, RESULT>, m: M): Observable<MatcherResultOrError<RESULT>> {
    return toObservable(matcher(m))
        .map(response => toMatcherResultOrError(response));
}

export interface HandlerWithResult <Z extends Routable, RESULT> {
    (m: Z, r: RESULT): Observableable<any>;
}

export interface Recognizer<M extends Routable, RECOGNIZERARGS, RESULT> {
    (recognizerArgs?: RECOGNIZERARGS): IfMatches<M, RESULT>
}

function combineScore(score, otherScore) {
    return score * otherScore
}

function routeWithCombinedScore(route: Route, newScore: number) {
    const score = combineScore(toScore(newScore), toScore(route.score));

    return toScore(route.score) === score
        ? route
        : {
            ... route,
            score
        } as Route;
}

export class IfMatchesElse <M extends Routable, RESULT> extends Router<M> {
    constructor(
        private matcher: Matcher<M, RESULT>,
        private getThenRouter: (result: RESULT) => Router<M>,
        private getElseRouter: (error: string) => Router<M>
    ) {
        super(m => match(matcher, m)
            .flatMap(matcherResultOrError => isMatcherResult(matcherResultOrError)
                ? getThenRouter(matcherResultOrError.result)
                    .getRoute(m)
                    .map(route => routeWithCombinedScore(route, matcherResultOrError.score))    
                : getElseRouter(matcherResultOrError.error)
                    .getRoute(m)
            )
        );
    }
}

export class IfMatchesThen <M extends Routable, RESULT = any> extends Router<M> {
    constructor(
        private matcher: Matcher<M, RESULT>,
        private getThenRouter: (result: RESULT) => Router<M>
    ) {
        super(m => match(matcher, m)
            .filter(matcherResultOrError => isMatcherResult(matcherResultOrError))
            .flatMap((matcherResult: MatcherResult<RESULT>) => getThenRouter(matcherResult.result)
                .getRoute(m)
                .map(route => routeWithCombinedScore(route, matcherResult.score))
            )
        );
    }

    elseDo(elseHandler: Handler<M>) {
        return this.elseTry(error => Router.do(elseHandler))
    }

    elseTry(getElseRouter: (error: string) => Router<M>) {
        return new IfMatchesElse(this.matcher, this.getThenRouter, getElseRouter)
    }
}

export class IfMatches <M extends Routable, RESULT> {
    constructor (
        private matcher: Matcher<M, RESULT>
    ) {
    }

    and(predicate: (m: M, result: RESULT) => Observableable<boolean | MatcherError>) {
        return new IfMatches<M, RESULT>(m => match(this.matcher, m)
            .flatMap(matcherResultOrError => isMatcherResult(matcherResultOrError)
                ? toObservable(predicate(m, matcherResultOrError.result))
                    .map(response => toMatcherResultOrError(response))
                    .map(_matcherResultOrError => isMatcherResult(_matcherResultOrError)
                        ? matcherResultOrError
                        : _matcherResultOrError
                    )
                : Observable.of(matcherResultOrError)
            )
        );
    }

    andTransform <TRANSFORMRESULT> (transformer: (c: M, result: RESULT) => Observableable<MatcherResult<TRANSFORMRESULT> | MatcherError | TRANSFORMRESULT>) {
        return new IfMatches<M, TRANSFORMRESULT>(m => match(this.matcher, m)
            .flatMap(matcherResultOrError => isMatcherResult(matcherResultOrError)
                ? toObservable(transformer(m, matcherResultOrError.result))
                    .map(response => toMatcherResultOrError<TRANSFORMRESULT>(response))
                    .map(_matcherResultOrError => isMatcherResult(_matcherResultOrError)
                        ? {
                            result: _matcherResultOrError.result,
                            score: combineScore(toScore(matcherResultOrError.score), toScore(_matcherResultOrError.score))
                        }
                        : _matcherResultOrError
                    )
                : Observable.of(matcherResultOrError)
            )
        );
    }

    thenDo(thenHandler: HandlerWithResult<M, RESULT>) {
        return this.thenTry(result => Router.do<M>(m => thenHandler(m, result)));
    }

    thenTry(router: Router<M>): IfMatchesThen<M, RESULT>;
    thenTry(getRouter: (result: RESULT) => Router<M>): IfMatchesThen<M, RESULT>;
    thenTry(arg) {
        return new IfMatchesThen(this.matcher, typeof arg === 'function'
            ? arg
            : result => arg
        );
    }
}

/*
const thrownRoute: Route = {
    thrown: true,
    action: () => {}
};

export function throwRoute <M extends Routable> () {
    return new Router<M>(m => Observable.of(thrownRoute));
}

export function catchRoute <M extends Routable> (routerOrHandler: RouterOrHandler<M>): Router<M> {
    return new Router<M>(m => Router
        .from(routerOrHandler)
        .getRoute(m)
        .filter(route => !route.thrown)
    );
}
*/

export class BeforeRouter <M extends Routable> extends Router<M> {
    constructor (beforeHandler: Handler<M>, router: Router<M>) {
        super(m => router
            .getRoute(m)
            .map(route => ({
                ... route,
                action: () => toObservable(beforeHandler(m))
                    .flatMap(_ => toObservable(route.action()))
            }))
        );
    }
}

export class AfterRouter <M extends Routable> extends Router<M> {
    constructor (afterHandler: Handler<M>, router: Router<M>) {
        super(m => router
            .getRoute(m)
            .map(route => ({
                ... route,
                action: () => toObservable(route.action())
                    .flatMap(_ => toObservable(afterHandler(m)))
            }))
        );
    }
}

export class DefaultRouter <M extends Routable> extends Router<M> {
    constructor (mainRouter: Router<M>, defaultRouter: Router<M>) {
        super(m => Observable.from([mainRouter, defaultRouter])
            .concatMap(router => router.getRoute(m))
            .take(1) // so that we don't keep going through routers after we find one that matches);
        );
    }
}

class NamedRouter <ARGS extends object = any, M extends object = any> {
    constructor(
        name: string,
        public getRouter: (args?: ARGS) => Router<M>,
        redefine = false
    ) {
        // add the router to the registry.
        // if name already exists and redefine is false, throw (or log) an error
    }
}

interface PromptArgs<WITHARGS, RECOGNIZERARGS> {
    recognizerArgs: RECOGNIZERARGS;
    withArgs: WITHARGS;
    turn: number;
}

interface PromptThenArgs<RESULT, WITHARGS, RECOGNIZERARGS> extends PromptArgs<WITHARGS, RECOGNIZERARGS> {
    result: RESULT;
}

interface PromptElseArgs<WITHARGS, RECOGNIZERARGS> extends PromptArgs<WITHARGS, RECOGNIZERARGS> {
    error: string;
}

class PromptThen <WITHARGS, RECOGNIZERARGS, RESULT, M extends Routable> extends NamedRouter<PromptArgs<WITHARGS, RECOGNIZERARGS>, M> {
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
                .elseTry(error => this.defaultPromptElseRouter({
                    ... promptArgs,
                    error
                }))
        );
    }

    private defaultPromptElseRouter(promptElseArgs: PromptElseArgs<WITHARGS, RECOGNIZERARGS>): Router<M> {
        // default retry logic goes here
        return Router.do(c => console.log("I should probably retry or something"));
    }

    elseDo(promptElseHandler: HandlerWithResult<M, PromptElseArgs<WITHARGS, RECOGNIZERARGS>>) {
        return this.elseTry(promptArgs => Router.do(m => promptElseHandler(m, promptArgs)));
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
                .elseTry(error => getPromptElseRouter({
                    ... promptArgs,
                    error
                })),
            true
        );
    }
}

class PromptRecognizer <WITHARGS, RECOGNIZERARGS, RESULT, M extends Routable> {
    constructor(
        private name: string,
        private recognizer: Recognizer<M, RECOGNIZERARGS, RESULT>
    ) {
    }

    thenDo(promptThenHandler: HandlerWithResult<M, PromptThenArgs<RESULT, WITHARGS, RECOGNIZERARGS>>) {
        return new PromptThen<WITHARGS, RECOGNIZERARGS, RESULT, M>(this.name, this.recognizer, promptArgs => Router.do(m => promptThenHandler(m, promptArgs))); 
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

class Prompt <WITHARGS extends object = any, M extends object = any> {
    constructor(
        private name: string,
    ) {
    }

    validate <ARG, RESULT> (recognizer: Recognizer<M, ARG, RESULT>) {
        return new PromptRecognizer<WITHARGS, ARG, RESULT, M>(this.name, recognizer);
    }
}


// Sample code

interface ActivityBase {
    type: string;
    from: { id: string, name: string }
}

interface MessageActivity extends ActivityBase {
    type: 'message';
    text: string;
}

interface TypingActivity extends ActivityBase {
    type: 'typing';
}

type Activity = MessageActivity | TypingActivity;

interface BotContext extends Routable {
    request: Activity;
    state: { conversation: any }
    reply: (text: string) => {};
}

// Recognizers

const ifMessage = () => new IfMatches((c: BotContext) => {
     if (c.request.type !== 'message')
        return { error: 'ifMessage.notMessage' }
    
    return c.request
});

const ifText = () => ifMessage()
    .andTransform((c, message) => {
        if (message.text.length === 0)
            return { error: 'ifText.noText' };
        
        return message.text;
    });

const ifRegExp = (regexp: RegExp) => ifText()
    .andTransform((c, text) => {
        const result = regexp.exec(text);
        if (!result)
            return { error: 'ifRegExp.noMatch' }

        return result;
    });

const ifIntro = () => ifRegExp(/I am (.*)/)
    .andTransform((c, matches) => ({ result: matches[0] }));

const ifNames = (... names: string[]) => ifIntro()
    .and((c, name) => {
        return names.includes(name) || { error: 'ifNames.noMatch' };
    });

const ifBillish = () => ifNames('Bill', 'Billy', 'William', 'Will', 'Willy');

const ifChoice = (choices: string[]) => ifText()
    .andTransform((c, text) => {
        const choice = choices.find(choice => choice.toLowerCase() === text.toLowerCase());
        if (!choice)
            return { error: 'ifChoice.notInChoices' }
        return choice;
    });

const ifTime = () => ifText()
    .andTransform((c, text) => {
        const result = new Date(text); // replace with an actual date parser
        if (!result)
            return { error: 'ifTime.didntParse' }
        return result;
    });

// Routers

ifTrue(c => true)
    .thenDo(c => console.log("true"))
    .elseTry(
        ifTrue(c => true).thenDo(c => console.log("false"))
    );

ifTrue(c => true).thenTry(
    tryInOrder(
        ifTrue(c => true).thenDo(c => console.log("hi")),
        ifTrue(c => false).thenDo(c => console.log("bye"))
    )
    .defaultDo(c => console.log("huh?"))
);

ifRegExp(/foo/i)
    .thenDo(c => console.log("matches!"));

ifRegExp(/Go to (.*)/i)
    .thenDo((c, matches) => console.log(`Let's go to ${matches[0]}`));

ifRegExp(/Go to (.*)/i).thenTry(
    tryInOrder(
        ifTrue<BotContext>(c => false).thenDo(c => console.log("hi")),
        ifTrue<BotContext>(c => false).thenDo(c => console.log("bye"))
    )
    .defaultDo(c => console.log("huh?"))
);

ifRegExp(/Go to (.*)/i).thenTry(matches =>
    tryInOrder(
        ifTrue<BotContext>(c => false).thenDo(c => console.log(`We're going to ${matches[0]}`)),
        ifTrue<BotContext>(c => false).thenDo(c => console.log("bye"))
    )
    .defaultDo(c => console.log("huh?"))
);

// create a prompt using a custom recognizer

const ifUsername = () => ifText()
    .and((c, text) => text.length > 5 && text.length < 20);

const getUsername = new Prompt('username')
    .validate(ifUsername)
    .thenDo((c, prompt) => {
        c.state.conversation.username = prompt.result;
    })
    // 'else' handler is optional - if present overrides the default handler
    .elseDo((c, prompt) => {
        c.reply("Usernames need to be the right length and stuff.");
        // then push it back on to the stack or whatever
    })

// dynamic prompt args

const getThing = new Prompt('thing')
    .validate(ifRegExp)
    .thenDo((c, matches) => c.reply("Yo"));

interface Alarm {
    title: string;
    time: Date;
}

const setAlarmController = (c: BotContext, alarmStuff: Alarm) => {
    if (!alarmStuff.title) {
        // call getTitle with alarmStuff
        return;
    }

    if (!alarmStuff.time) {
        // call getTime with alarmStuff
        return;
    }

    // then get the time if we don't have it
    // then set the alarm
}

const getTitle = new Prompt<Alarm>('title')
    .validate(ifText)
    .thenDo((c, prompt) => {
        setAlarmController(c, {
            ... prompt.withArgs,
            title: prompt.result
        });
    })
    .elseDo((c, prompt) => {
        switch(prompt.error) {
            case 'ifText.noText':
                c.reply("Please supply a title.");
            default:
                c.reply("Say something, anything!");            
        }
    })

const getTime = new Prompt<Alarm>('title')
    .validate(ifTime)
    .thenDo((c, prompt) => {
        setAlarmController(c, {
            ... prompt.withArgs,
            time: prompt.result
        });
    });

const flavors = ["chocolate", "vanilla", "strawberry"];

const getFlavor = new Prompt<Alarm>('flavor')
    .ask(choiceRenderer)
    .validate(ifChoice)
    .thenDo((c, prompt) => {
        setAlarmController(c, {
            ... prompt.withArgs,
            title: prompt.result
        });
    })
    .elseDo((c, prompt) => {
    
    })
    .args(flavors);

    prompt.call(getFlavor.with(foo).ask("What flavor").args(flavors))


interface Renderer<RECOGNIZERARGS> {
    ({
        recognizerArgs: RECOGNIZERARGS;
        text: string;
    }): Activity;
}
/*

Stuff this model doesn't seem to support

* how "with" is supplied on call
* outgoing messages all up

Prompts are:

* an outgoing message (not supplied by this model at all)
* a validator/recognizer for the response
* ... the arguments for which might be supplied at runtime (e.g. list of choices)
* a handler for a validated response
* an optional handler for a non-validated response (with a default if not supplied)

Would be nice if the "fluent" part read like a sentence. "Prompt" is almost certainly not the right word.

Recognizers being if* is screwing that up a bit.

*/
