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

export interface ActionRoute {
    type: 'action';
    action: () => Observableable<any>;
    score: number;
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
        score: number = 1
    ) {
        return {
            type: 'action',
            action,
            score
        } as ActionRoute;
    }

    static do <M extends Routable> (
        handler: Handler<M>,
        score?: number
    ) {
        return new Router<M>(m => Observable.of(Router.actionRoute(() => handler(m), score)));
    }
    
    static noop <M extends Routable> (handler: Handler<M>) {
        return new RunRouter(handler);
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
            .filter(router => !!router)
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

export class BestRouter <M extends Routable> extends Router<M> {
    private static minRoute = Router.actionRoute(
        () => {
            console.warn("BestRouter.minRoute.action should never be called");
        },
        0
    );
    
    constructor(... routers: Router<M>[]) {
        super(m => new Observable<Route>(observer => {
            let bestRoute = BestRouter.minRoute;

            const subscription = Observable.from(routers)
                .filter(router => !!router)
                .takeWhile(_ => bestRoute.score < 1)
                .concatMap(router => router.getRoute(m))
                .filter(route => route.type === 'action')
                .defaultIfEmpty(Router.noRoute('tryInScoreOrder'))
                .subscribe(
                    (route: ActionRoute) => {
                        if (route.score > bestRoute.score) {
                            bestRoute = route;
                            if (bestRoute.score === 1) {
                                observer.next(bestRoute);
                                observer.complete();
                            }
                        }
                    },
                    error =>
                        observer.error(error),
                    () => {
                        if (bestRoute.score > 0)
                            observer.next(bestRoute);
                        observer.complete();
                    }
                );

            return () => subscription.unsubscribe();
        }));
    }
}

export function tryInScoreOrder <M extends Routable> (... routers: Router<M>[]) {
    return new BestRouter(... routers);
}

export class RunRouter <M extends Routable> extends Router<M> {
    constructor(handler: Handler<M>) {
        super(m => toObservable(handler(m))
            .map(_ => Router.noRoute('noop'))
        );
    }
}

export interface Match<RESULT> {
    result: RESULT;
    score: number;
}

export interface NoMatch {
    reason: string;
}

export type MatcherResponse<RESULT> = Match<RESULT> | NoMatch;

export type Matcher <M, RESULT> = (m: M) => Observableable<MatcherResponse<RESULT> | RESULT>;

export type Recognizer<M extends Routable, RECOGNIZERARGS, RESULT> =
    (recognizerArgs?: RECOGNIZERARGS) => IfMatches<M, RESULT>;

function combineScore(score, otherScore) {
    return score * otherScore
}

export function routeWithCombinedScore(route: ActionRoute, newScore: number) {
    const score = combineScore(newScore, route.score);

    return route.score === score
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
            .map(response => IfMatches.normalizeMatcherResponse<RESULT>(response))
            .flatMap(matcherResponse => IfMatches.isMatch(matcherResponse)
                ? getThenRouter(matcherResponse.result)
                    .getRoute(m)
                    .map(route => route.type === 'action'
                        ? routeWithCombinedScore(route, matcherResponse.score)
                        : route
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
            .map(response => IfMatches.normalizeMatcherResponse<RESULT>(response))
            .flatMap(matcherResponse => IfMatches.isMatch(matcherResponse)
                ? getThenRouter(matcherResponse.result)
                    .getRoute(m)
                    .map(route => route.type === 'action'
                        ? routeWithCombinedScore(route, matcherResponse.score)
                        : route
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
            .map(response => IfMatches.normalizeMatcherResponse<RESULT>(response))
            .flatMap(matcherResponse => IfMatches.isMatch(matcherResponse)
                ? toObservable(recognizer(matcherResponse.result))
                    .flatMap(_ifMatches => toObservable(_ifMatches.matcher(m))
                        .map(_response => IfMatches.normalizeMatcherResponse(_response))
                        .map(_matcherResponse => IfMatches.isMatch(_matcherResponse)
                            ? _ifMatches instanceof ifTrue
                                ? matcherResponse
                                : {
                                    result: _matcherResponse.result,
                                    score: combineScore(matcherResponse.score, _matcherResponse.score)
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

    static match<RESULT>(
        result: RESULT,
        score: number = 1
    ) {
        return {
            result,
            score
        } as Match<RESULT>;
    }

    static noMatch(
        reason: string = "none"
    ) {
        return {
            reason
        } as NoMatch;
    }

    static isMatch <RESULT> (matcherResponse: MatcherResponse<RESULT>): matcherResponse is Match<RESULT> {
        return (matcherResponse as any).result !== undefined;
    }

    static normalizeMatcherResponse <RESULT> (response: any): MatcherResponse<RESULT> {
        if (!response)
            return IfMatches.noMatch();
    
        if (typeof(response) === 'object') {
            if (response.reason) {
                if (typeof(response.reason) !== 'string')
                    throw new Error('The reason for NoMatch must be a string');
                return IfMatches.noMatch(response.reason);
            }
    
            if (response.result !== undefined) {
                if (response.score !== undefined && typeof(response.score) !== 'number')
                    throw new Error('The score for Match must be a number');
                return IfMatches.match(response.result as RESULT, response.score);
            }
        }
    
        return IfMatches.match(response as RESULT);
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
            .map((response: any) => {
                if (response === true || response === false)
                    return response;

                if (typeof(response) === 'object') {
                    if (response.reason)
                        return response;
                    if (response.result !== undefined) {
                        if (response.result === false)
                            return false;
                        if (response.result === true)
                            return response;
                        throw new Error('When returning a Match from the predicate for IfTrue, the result must be true or false');
                    }
                }

                throw new Error('The predicate for ifTrue may only return true, false, a Match of true or false, or a NoMatch');
            })
        );
    }
}

export function ifTrue <M extends Routable> (
    predicate: Predicate<M>
): IfTrue<M> {
    return new IfTrue(predicate);
}

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
