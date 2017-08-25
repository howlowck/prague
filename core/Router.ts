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

export interface Match {
    score?: number;
}

export interface Router <M extends Match> {
    getRoute(m: M): Observable<Route>;
}

export const nullRouter = {
    getRoute: (m) => Observable.empty()
} as Router<any>;

export function routeMessage <M extends Match> (router: Router<M>, m: M) {
    return router.getRoute(m)
        .do(route => konsole.log("handle: matched a route", route))
        .flatMap(route => toObservable(route.action()))
        .do(_ => konsole.log("handle: called action"));
}

export interface Handler <Z extends Match = {}> {
    (m: Z): Observableable<any>;
}

export type RouterOrHandler <M extends Match = {}> = Router<M> | Handler<M>;

export function isRouter <M extends Match> (routerOrHandler: RouterOrHandler<M>): routerOrHandler is Router<M> {
    return ((routerOrHandler as any).getRoute !== undefined);
}

export function simpleRouter <M extends Match> (handler: Handler<M>): Router<M> {
    return {
        getRoute: (m) => Observable.of({
            action: () => handler(m)
        } as Route)
    }
}

export function toRouter <M extends Match> (routerOrHandler: RouterOrHandler<M>): Router<M> {
    return isRouter(routerOrHandler) ? routerOrHandler : simpleRouter(routerOrHandler);
}

function filteredRouter$ <M extends Match> (... routersOrHandlers: RouterOrHandler<M>[]) {
    return Observable.from(routersOrHandlers)
        .filter(routerOrHandler => !!routerOrHandler)
        .map(routerOrHandler => toRouter(routerOrHandler));
}

export function first <M extends Match> (... routersOrHandlers: RouterOrHandler<M>[]): Router<M> {
    const routers = filteredRouter$(... routersOrHandlers);
    return {
        getRoute: (m) => routers
            .concatMap(
                (router, i) => {
                    konsole.log(`first: trying router #${i}`);
                    return router.getRoute(m)
                        .do(n => konsole.log(`first: router #${i} succeeded`, n));
                }
            )
            .take(1) // so that we don't keep going through routers after we find one that matches
    }
}

const minRoute: Route = {
    score: 0,
    action: () => console.warn("This should never be called")
}

function toScore (score: number) {
    return score == null ? 1 : score;
}

const takeWhileInclusive = <R>(predicate: (r: R) => boolean) => (source: Observable<R>) =>
    new Observable(observer => {
        const subscription = source.subscribe({
            next: value => {
                observer.next(value);

                if (!predicate(value)) {
                    observer.complete();
                }
            },
            error: error => observer.error(error),
            complete: () => observer.complete()
        });

        return () => subscription.unsubscribe();
    });

export function best <M extends Match> (... routersOrHandlers: RouterOrHandler<M>[]): Router<M> {
    const routers = filteredRouter$(... routersOrHandlers);
    return {
        getRoute: (m) => routers
            .concatMap(
                (router, i) => {
                    konsole.log(`best: trying router #${i}`);
                    return router.getRoute(m)
                        .do(n => konsole.log(`best: router #${i} succeeded`, n));
                }
            )
            .let<Route, Route>(takeWhileInclusive<Route>(route => toScore(route.score) < 1))
            .scan(
                (prev, current) => toScore(prev.score) >= toScore(current.score) ? prev : current,
                minRoute
            )
            .filter(route => toScore(route.score) > 0)
    }
}

export function run <M extends Match> (handler: Handler<M>): Router<M> {
    return {
        getRoute: (m) =>
            toObservable(handler(m))
                .filter(_ => false)
    }
}

export interface Matcher <M extends Match = {}, Z extends Match = {}> {
    (m: M): Observableable<Z>;
}

export interface Predicate <M extends Match = {}> {
    (m: M): Observableable<boolean>;
}

export function tryMatch <M extends Match, N extends Match> (matcher: Matcher<M, N>, m: M): Observable<N>;
export function tryMatch <M extends Match> (predicate: Predicate<M>, m: M): Observable<M>;
export function tryMatch <M extends Match> (predicateOrMatcher: Predicate | Matcher, m: M): Observable<any>;
export function tryMatch(predicateOrMatcher: Matcher | Predicate, m): Observable<any> {
    // we want to allow any matcher to be a predicate (return a boolean)
    // if so, the 'falsey' case will be filtered out by toFilteredObservable,
    // so we just need to catch the case where it is precisely true
    konsole.log("tryMatch", predicateOrMatcher, m);
    return toFilteredObservable(predicateOrMatcher(m))
        .map(n => typeof n === 'boolean' ? m : n);
}

export function combineScores(previousScore, nextScore) {
    return toScore(previousScore) * toScore(nextScore);
}

export function routeWithCombinedScore(route: Route, score?: number) {
    return {
        ... route,
        score: combineScores(score, route.score)
    }
}

export function ifMatch <M extends Match> (
    predicate: Predicate<M>,
    ifRouterOrHandler: RouterOrHandler<M>,
    elseRouterOrHandler?: RouterOrHandler<M>,
): Router<M>;

export function ifMatch <M extends Match, N extends Match> (
    matcher: Matcher<M, N>,
    ifRouterOrHandler: RouterOrHandler<N>,
    elseRouterOrHandler?: RouterOrHandler<M>,
): Router<M>;

export function ifMatch <M extends Match> (
    predicateOrMatcher: Predicate<M> | Matcher<M>,
    ifRouterOrHandler: RouterOrHandler,
    elseRouterOrHandler?: RouterOrHandler,
): Router<M> {
    const ifRouter = toRouter(ifRouterOrHandler);
    const elseRouter = elseRouterOrHandler
        ? toRouter(elseRouterOrHandler)
        : nullRouter;
    return {
        getRoute: (m) =>
            tryMatch(predicateOrMatcher, m)
                .defaultIfEmpty(null)
                .flatMap((n: Match) => n
                    ? ifRouter.getRoute(n)
                        .map(route => routeWithCombinedScore(route, n.score))    
                    : elseRouter.getRoute(m)
                        .map(route => routeWithCombinedScore(route, m.score))    
                )
    }
}

const thrownRoute: Route = {
    thrown: true,
    action: () => {}
};

export function throwRoute <M extends Match> (): Router<M> {
    return {
        getRoute: (m) => Observable.of(thrownRoute)
    }
}

export function catchRoute <M extends Match> (routerOrHandler: RouterOrHandler<M>): Router<M> {
    return {
        getRoute: (m) => toRouter(routerOrHandler).getRoute(m)
            .filter(route => !route.thrown)
    }
}

export function matchAll <M extends Match, Z extends Match> (m1: Matcher<M, Z>): Matcher<M, Z>
export function matchAll <M extends Match> (p1: Predicate<M>): Matcher<M, M>

export function matchAll <M extends Match, N extends Match, Z extends Match> (m1: Matcher<M, N>, m2: Matcher<N, Z>): Matcher<M, Z>
export function matchAll <M extends Match, Z extends Match> (p1: Predicate<M>, m2: Matcher<M, Z>,): Matcher<M, Z>
export function matchAll <M extends Match, Z extends Match> (m1: Matcher<M, Z>, p2: Predicate<Z>): Matcher<M, Z>
export function matchAll <M extends Match> (p1: Predicate<M>, p2: Predicate<M>): Matcher<M, M>

export function matchAll <M extends Match, N extends Match, O extends Match, Z extends Match> (m1: Matcher<M, N>, m2: Matcher<N, O>, m3: Matcher<O, Z>): Matcher<M, Z>
export function matchAll <M extends Match, N extends Match, Z extends Match> (p1: Predicate<M>, m2: Matcher<M, N>, m3: Matcher<N, Z>, routerOrHandler: RouterOrHandler<Z>): Matcher<M, Z>
export function matchAll <M extends Match, N extends Match, Z extends Match> (m1: Matcher<M, N>, p2: Predicate<N>, m3: Matcher<N, Z>, routerOrHandler: RouterOrHandler<Z>): Matcher<M, Z>
export function matchAll <M extends Match, N extends Match, Z extends Match> (m1: Matcher<M, N>, m2: Matcher<N, Z>, p3: Predicate<Z>, routerOrHandler: RouterOrHandler<Z>): Matcher<M, Z>
export function matchAll <M extends Match, Z extends Match> (m1: Matcher<M, Z>, p2: Predicate<Z>, p3: Predicate<Z>, routerOrHandler: RouterOrHandler<Z>): Matcher<M, Z>
export function matchAll <M extends Match, Z extends Match> (p1: Matcher<M>, m2: Matcher<M, Z>, p3: Predicate<Z>, routerOrHandler: RouterOrHandler<Z>): Matcher<M, Z>
export function matchAll <M extends Match, Z extends Match> (p1: Predicate<M>, p2: Predicate<M>, m3: Matcher<M, Z>, routerOrHandler: RouterOrHandler<Z>): Matcher<M, Z>
export function matchAll <M extends Match> (p1: Predicate<M>, p2: Predicate<M>, p3: Predicate<M>): Matcher<M, M>

export function matchAll <M extends Match> (... matchersOrPredicates: (Matcher|Predicate)[]): Matcher<M>

export function matchAll <M extends Match> (... args: Matcher[]): Matcher<M> {
    return m => {
        konsole.log("matchAll", args, m)
        return Observable.from(args)
            .reduce<Matcher, Observable<any>> (
                (prevObservable, currentMatcher, i) =>
                    prevObservable
                    .flatMap(prevMatch => {
                        konsole.log(`calling matcher #${i}`, currentMatcher);
                        return tryMatch(currentMatcher, prevMatch)
                            .do(result => konsole.log("result", result))
                            .map((n: Match) => ({
                                ... n,
                                score: combineScores(prevMatch.score, n.score)
                            }));
                    }),
                Observable.of(m)
            )
            .mergeAll();
    }
}

export function firstMatch <M extends Match> (... predicatesOrMatchers: (Predicate<M> | Matcher<M>)[]): Matcher<M> {
    konsole.log("firstMatch", predicatesOrMatchers);
    return m =>
        Observable.from(predicatesOrMatchers)
            .concatMap(predicateOrMatcher => tryMatch(predicateOrMatcher, m))
            .take(1);
}

export function bestMatch <M extends Match> (... predicatesOrMatchers: (Predicate<M> | Matcher<M>)[]): Matcher<M> {
    konsole.log("bestMatch", predicatesOrMatchers);
    return m =>
        Observable.from(predicatesOrMatchers)
            .concatMap(predicateOrMatcher => tryMatch(predicateOrMatcher, m))
            .do((match: Match) => console.log("after flatMap", match))
            // .takeWhile((match: Match) => toScore(match.score) !== 1)
            .do((match: Match) => console.log("after takeWhile", match))
            .scan<Match, Match>((prevMatch, match) => toScore(prevMatch.score) >= toScore(match.score) ? prevMatch : match, { score: 0 })
            .filter(match => match.score > 0);
}
