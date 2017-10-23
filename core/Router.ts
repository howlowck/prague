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

export interface ActionRoute {
    type: 'action';
    action: () => Observableable<any>;
    score?: number;
}

export interface NoRoute {
    type: 'no';
    reason: string;
}

export type Route = ActionRoute | NoRoute;

export type Routable = object;

export type Handler <Z extends Routable> =
    (m: Z) => Observableable<any>;

export class Router <M extends Routable> {
    constructor(public getRoute: (m: M) => Observable<Route>) {}

    static actionRoute <M extends Routable> (
        action: () => Observableable<any>,
        score?: number
    ) {
        return {
            type: 'action',
            action,
            score
        } as ActionRoute;
    }

    static do <M extends Routable> (handler: Handler<M>) {
        return new Router<M>(m => Observable.of(Router.actionRoute(() => handler(m))));
    }
    
    static noRoute <M extends Routable> (reason: string = "none") {
        return {
            type: 'no',
            reason
        } as NoRoute;
    }

    static no (reason?: string) {
        return new Router<any>(m => Observable.of(Router.noRoute(reason)));
    }

    route (m: M) {
        return this
            .getRoute(m)
            .do(route => konsole.log("route: returned a route", route))
            .filter(route => route.type === 'action')
            .flatMap((route: ActionRoute) => toObservable(route.action()))
            .do(_ => konsole.log("route: called action"));
    }

    beforeDo (handler: Handler<M>) {
        return new BeforeRouter<M>(handler, this);
    }

    afterDo (handler: Handler<M>) {
        return new AfterRouter<M>(handler, this);
    }

    defaultDo (handler: (m: M, reason: string) => Observableable<any>) {
        return this.defaultTry(reason => Router.do(m => handler(m, reason)));
    }

    defaultTry (getRouter: (reason: string) => Router<M>): Router<M>;
    defaultTry (router: Router<M>): Router<M>;
    defaultTry (arg) {
        return new DefaultRouter<M>(this, typeof(arg) === 'function'
            ? arg
            : reason => arg
        );
    }
}

export class FirstRouter <M extends Routable> extends Router<M> {
    constructor (... routers: Router<M>[]) {
        super(m => Observable.from(routers)
            .concatMap((router, i) => {
                konsole.log(`first: trying router #${i}`);
                return router
                    .getRoute(m)
                    .do(route => konsole.log(`first: router #${i} returned route`, route));
            })
            .filter(route => route.type === 'action')
            .take(1) // so that we don't keep going through routers after we find one that matches;
            .defaultIfEmpty(Router.noRoute('tryInOrder'))
        );
    }
}

// calls getRoute on each router in turn, returning the first ActionRoute returned, else returning a NoRoute
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
            .map(_ => Router.noRoute('run'))
        );
    }
}

export function run <M extends Routable> (handler: Handler<M>) {
    return new RunRouter(handler);
}

export interface MatcherResult<RESULT> {
    result: RESULT;
    score?: number;
}

export interface NoMatch {
    reason: string;
}

export type MatcherResponse<RESULT> = MatcherResult<RESULT> | NoMatch;

export type Matcher <M, RESULT> = (m: M) => Observableable<MatcherResponse<RESULT> | RESULT>;

function isMatcherResult <RESULT> (matcherResponse: MatcherResponse<RESULT>): matcherResponse is MatcherResult<RESULT> {
    return (matcherResponse as any).result !== undefined;
}

function normalizeMatcherResponse <RESULT> (response: any): MatcherResponse<RESULT> {
    if (!response)
        return {
            reason: 'no'
        }

    if (typeof(response) === 'object' && (response.reason || response.result))
        return response;

    return {
        result: response as RESULT
    }
}

export type Recognizer<M extends Routable, RECOGNIZERARGS, RESULT> =
    (recognizerArgs?: RECOGNIZERARGS) => IfMatches<M, RESULT>;

function combineScore(score, otherScore) {
    return score * otherScore
}

function routeWithCombinedScore(route: ActionRoute, newScore: number) {
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
        private getElseRouter: (reason: string) => Router<M>
    ) {
        super(m => toObservable(matcher(m))
            .map(response => normalizeMatcherResponse<RESULT>(response))
            .flatMap(matcherResponse => isMatcherResult(matcherResponse)
                ? getThenRouter(matcherResponse.result)
                    .getRoute(m)
                    .map(route => route.type === 'action'
                        ? routeWithCombinedScore(route, matcherResponse.score)
                        : Router.noRoute('foo')
                    )
            : getElseRouter(matcherResponse.reason)
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
        super(m => toObservable(matcher(m))
            .map(response => normalizeMatcherResponse<RESULT>(response))
            .flatMap(matcherResponse => isMatcherResult(matcherResponse)
                ? getThenRouter(matcherResponse.result)
                    .getRoute(m)
                    .map(route => route.type === 'action'
                        ? routeWithCombinedScore(route, matcherResponse.score)
                        : Router.noRoute('foo')
                    )
                : Observable.of(Router.noRoute(matcherResponse.reason))
            )
        );
    }

    elseDo(elseHandler: (m: M, reason: string) => Observableable<any>) {
        return this.elseTry(reason => Router.do(m => elseHandler(m, reason)));
    }

    elseTry(elseRouter: Router<M>): IfMatchesElse<M, RESULT>;
    elseTry(getElseRouter: (reason: string) => Router<M>): IfMatchesElse<M, RESULT>;
    elseTry(arg) {
        return new IfMatchesElse(this.matcher, this.getThenRouter, typeof(arg) === 'function'
            ? arg
            : reason => arg
        );
    }
}

export class IfMatches <M extends Routable, RESULT> {
    constructor (
        private matcher: Matcher<M, RESULT>
    ) {
    }

    and (predicate: (result: RESULT) => IfTrue<M>): IfMatches<M, RESULT>;
    and <TRANSFORMRESULT> (recognizer: (result: RESULT) => IfMatches<M, TRANSFORMRESULT>): IfMatches<M, TRANSFORMRESULT>;
    and <TRANSFORMRESULT> (recognizer: (result: RESULT) => IfMatches<M, TRANSFORMRESULT>) {
        return ifMatches((m: M) => toObservable(this.matcher(m))
            .map(response => normalizeMatcherResponse<RESULT>(response))
            .flatMap(matcherResponse => isMatcherResult(matcherResponse)
                ? toObservable(recognizer(matcherResponse.result))
                    .flatMap(_ifMatches => toObservable(_ifMatches.matcher(m))
                        .map(_response => normalizeMatcherResponse(_response))
                        .map(_matcherResponse => isMatcherResult(_matcherResponse)
                            ? _ifMatches instanceof ifTrue
                                ? matcherResponse
                                : {
                                    result: _matcherResponse.result,
                                    score: combineScore(toScore(matcherResponse.score), toScore(_matcherResponse.score))
                                }
                            : _matcherResponse
                        )
                    )
                : Observable.of(matcherResponse)
            )
        );
    }

    thenDo(thenHandler: (m: M, result: RESULT) => Observableable<any>) {
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

export function ifMatches <M extends Routable, RESULT>(
    matcher: Matcher<M, RESULT>
) {
    return new IfMatches(matcher);
}

export type Predicate <M extends Routable> = Matcher<M, boolean>;

export class IfTrue <M extends Routable> extends IfMatches<M, boolean> {
    constructor(
        predicate: Predicate<M>
    ) {
        super(m => toObservable(predicate(m))
            .map((response: any) => typeof(response) === 'object' && (response.reason || response.result)
                ? response
                : !!response
            )
        );
    }
}

export function ifTrue <M extends Routable> (
    predicate: Predicate<M>
): IfTrue<M> {
    return new IfTrue(predicate);
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
            .map(route => route.type === 'action'
                ? {
                    ... route,
                    action: () => toObservable(beforeHandler(m))
                        .flatMap(_ => toObservable(route.action()))
                }
                : route
            )
        );
    }
}

export class AfterRouter <M extends Routable> extends Router<M> {
    constructor (afterHandler: Handler<M>, router: Router<M>) {
        super(m => router
            .getRoute(m)
            .map(route => route.type === 'action'
                ? {
                    ... route,
                    action: () => toObservable(route.action())
                        .flatMap(_ => toObservable(afterHandler(m)))
                }
                : route
            )
        );
    }
}

export class DefaultRouter <M extends Routable> extends Router<M> {
    constructor (
        mainRouter: Router<M>,
        getDefaultRouter: (reason: string) => Router<M>
    ) {
        super(m => mainRouter.getRoute(m)
            .flatMap(route => route.type === 'action'
                ? Observable.of(route)
                : getDefaultRouter(route.reason).getRoute(m)
            )
        );
    }
}

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
