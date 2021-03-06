import * as angular from 'angular';
import * as deepmerge from 'deepmerge';
import getFilePath from 'wikimedia-commons-file-path';

import {CommonsFile, CommonsTitle, LatLng} from '../model';

const maxTitlesPerRequest = 50;

export default class LtData {
  public static $inject = [
    '$http',
    '$httpParamSerializer',
    '$parse',
    '$sce',
    '$q',
    'gettextCatalog',
    'limitToFilter'
  ];
  constructor(
    private $http: ng.IHttpService,
    private $httpParamSerializer: ng.IHttpParamSerializer,
    private $parse: ng.IParseService,
    private $sce: ng.ISCEService,
    private $q: ng.IQService,
    private gettextCatalog: any,
    private limitToFilter: ng.IFilterLimitTo
  ) {}

  getCoordinates(titles: CommonsTitle[]): ng.IPromise<CommonsFile[]> {
    if (angular.isString(titles)) {
      titles = titles.split('|');
    }
    if (titles.length > maxTitlesPerRequest) {
      return this.getCoordinatesChunkByChunk(titles);
    }
    const params = {
      prop: 'coordinates',
      colimit: 500,
      coprop: 'type|name',
      coprimary: 'all',
      titles: titles.join('|').replace(/_/g, ' ')
    };
    return this.$query<any>(params).then(data => {
      const pages = (data && data.query && data.query.pages) || {};
      return Object.keys(pages).map(pageid => {
        const page = pages[pageid];
        const coordinates = page.coordinates || [];
        return {
          pageid: parseInt(pageid),
          file: page.title,
          url: `https://commons.wikimedia.org/wiki/${page.title}`,
          imageUrl(width: number) {
            return getFilePath(this.file, width);
          },
          coordinates: new LatLng(
            'Location',
            toLatLng(coordinates.find(c => c.primary === '' && c.type === 'camera'))
          ),
          objectLocation: new LatLng(
            'Object location',
            toLatLng(coordinates.find(c => c.type === 'object'))
          )
        } as CommonsFile;
      });
      function toLatLng(c) {
        return angular.isObject(c) ? {lat: c.lat, lng: c.lon} : {};
      }
    });
  }

  getCoordinatesChunkByChunk(titles: CommonsTitle[]): ng.IPromise<CommonsFile[]> {
    const t = [...titles];
    const requests: CommonsTitle[][] = [];
    while (t.length) {
      requests.push(t.splice(0, Math.min(maxTitlesPerRequest, t.length)));
    }
    const coordinatesPromises = requests.map(x => this.getCoordinates(x));
    return this.$q.all(coordinatesPromises).then(x => flatten(x));

    function flatten<T>(array: T[][]) {
      const result: T[] = [];
      return result.concat(...array);
    }
  }

  getFileDetails(pageid) {
    const params = {
      prop: 'categories|imageinfo|revisions',
      clshow: '!hidden',
      pageids: pageid,
      iiprop: 'url|extmetadata',
      iiextmetadatafilter: 'ImageDescription|Artist|DateTimeOriginal',
      iiextmetadatalanguage: this.gettextCatalog.getCurrentLanguage(),
      rvprop: 'content'
    };
    const descriptionGetter = this.$parse('imageinfo[0].extmetadata.ImageDescription.value');
    const authorGetter = this.$parse('imageinfo[0].extmetadata.Artist.value');
    const timestampGetter = this.$parse('imageinfo[0].extmetadata.DateTimeOriginal.value');
    const urlGetter = this.$parse('imageinfo[0].descriptionurl');
    return this.$query<any>(params).then(data => {
      const page = (data && data.query && data.query.pages && data.query.pages[pageid]) || {};
      const categories = ((page && page.categories) || []).map(category =>
        category.title.replace(/^Category:/, '')
      );
      return {
        categories,
        description: this.$sce.trustAsHtml(descriptionGetter(page)),
        author: this.$sce.trustAsHtml(authorGetter(page)),
        timestamp: timestampGetter(page),
        url: urlGetter(page),
        objectLocation: extractObjectLocation(page)
      };
    });

    function extractObjectLocation(page) {
      try {
        const wikitext = page.revisions[0]['*'];
        const locDeg = wikitext.match(
          /\{\{Object location( dec)?\|([0-9]+)\|([0-9]+)\|([0-9.]+)\|([NS])\|([0-9]+)\|([0-9]+)\|([0-9.]+)\|([WE])/i
        );
        const loc = wikitext.match(/\{\{Object location( dec)?\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)/i);
        let lat;
        let lng;
        if (locDeg) {
          lat = parseInt(locDeg[2]) + parseInt(locDeg[3]) / 60 + parseFloat(locDeg[4]) / 3600;
          lat *= locDeg[5] === 'N' ? 1 : -1;
          lng = parseInt(locDeg[6]) + parseInt(locDeg[7]) / 60 + parseFloat(locDeg[8]) / 3600;
          lng *= locDeg[9] === 'E' ? 1 : -1;
        } else if (loc) {
          lat = parseFloat(loc[2]);
          lng = parseFloat(loc[3]);
        }
        return new LatLng('Object location', {lat, lng});
      } catch (e) {
        return new LatLng('Object location', {});
      }
    }
  }

  getCategoriesForPrefix(prefix: string): ng.IPromise<CommonsTitle[]> {
    const params = {
      list: 'allpages',
      apnamespace: 14,
      aplimit: 30,
      apfrom: prefix,
      apprefix: prefix
    };
    return this.$query<any>(params, {}, () => false).then(data =>
      data.query.allpages.map(i => i.title.replace(/^Category:/, '' as CommonsTitle))
    );
  }

  getFiles({
    files,
    user,
    userLimit,
    userStart,
    userEnd,
    category,
    categoryDepth
  }: {
    files: CommonsTitle[];
    user: string;
    userLimit: number;
    userStart: number;
    userEnd: number;
    category: string;
    categoryDepth: number;
  }): ng.IPromise<CommonsTitle[]> {
    return this.$q((resolve, reject) => {
      if (files) {
        resolve(files);
      } else if (user) {
        this.getFilesForUser(user, userLimit, userStart, userEnd).then(resolve);
      } else if (category) {
        this.getFilesForCategory(category, categoryDepth).then(resolve);
      } else {
        reject();
      }
    });
  }

  getFilesForUser(
    user: string,
    userLimit: number,
    userStart: number,
    userEnd: number
  ): ng.IPromise<CommonsTitle[]> {
    // https://commons.wikimedia.org/w/api.php?action=help&modules=query%2Ballimages
    const params = {
      generator: 'allimages',
      gaiuser: user,
      gailimit: typeof userLimit === 'number' && userLimit <= 500 ? userLimit : 'max',
      gaistart: userEnd, // sic! (due to gaidir)
      gaiend: userStart, // sic! (due to gaidir)
      gaisort: 'timestamp',
      gaidir: 'older'
    };
    const toPageArray = data => Object.keys(data.query.pages).map(id => data.query.pages[id]);
    const shouldContinue = data =>
      data.continue && (!userLimit || toPageArray(data).length < userLimit);
    return this.$query(params, {}, shouldContinue)
      .then(data => toPageArray(data).map(page => page.title as CommonsTitle))
      .then(pages => (userLimit ? this.limitToFilter(pages, userLimit) : pages));
  }

  getFilesForCategory(cat: string, depth = 3): ng.IPromise<CommonsTitle[]> {
    cat = cat.replace(/^Category:/, '');
    return this.successRace([
      this.getFilesForCategory1(cat, depth),
      this.getFilesForCategory2(cat, depth),
      this.getFilesForCategory3(cat, depth)
    ]);
  }

  getFilesForCategory1(cat: string, depth: number): ng.IPromise<CommonsTitle[]> {
    const params = {
      lang: 'commons',
      cat: cat.replace(/^Category:/, ''),
      type: 6, // File:
      depth: depth,
      json: 1
    };
    return this.$http
      .get<CommonsTitle[]>('https://tools.wmflabs.org/cats-php/', {params})
      .then(d => d.data.map(f => `File:${f}`));
  }

  getFilesForCategory2(cat, depth): ng.IPromise<CommonsTitle[]> {
    const params = {
      action: 'query',
      lang: 'commons',
      query: cat,
      querydepth: depth,
      flaws: 'ALL',
      format: 'json'
    };
    return this.$http
      .get<any[]>('/render/tlgbe/tlgwsgi.py', {params, transformResponse})
      .then(d => {
        const exceptions = d.data.filter(x => !!x.exception).map(x => x.exception);
        if (exceptions.length) {
          throw new Error(exceptions[0]);
        }
        return d.data.filter(x => !!x.page).map(x => x.page.page_title as CommonsTitle);
      });
    function transformResponse(value) {
      // tlgwsgi returns one JSON object per line w/o commas in between
      const array = `[${value.replace(/\n/g, ',').replace(/,$/, '')}]`;
      return JSON.parse(array);
    }
  }

  getFilesForCategory3(categories: string, depth: number): ng.IPromise<CommonsTitle[]> {
    const params = {
      language: 'commons',
      project: 'wikimedia',
      depth,
      categories,
      'ns[6]': 1,
      format: 'json',
      sparse: 1,
      doit: 1
    };
    return this.$http
      .get<any[]>('https://petscan.wmflabs.org/', {params})
      .then(d => d.data['*'][0]['a']['*'] as CommonsTitle[]);
  }

  private $query<T>(
    query,
    previousResults = {},
    shouldContinue = data => !!data.continue
  ): ng.IPromise<T> {
    const data = this.$httpParamSerializer(query);
    const params = {
      action: 'query',
      format: 'json',
      origin: '*'
    };
    return this.$http
      .post('https://commons.wikimedia.org/w/api.php', data, {params})
      .then(d => d.data)
      .then(data => deepmerge(previousResults, data, {arrayMerge: (x, y) => [].concat(...x, ...y)}))
      .then(
        data =>
          shouldContinue(data)
            ? this.$query(
                angular.extend(query, {continue: undefined}, data.continue),
                angular.extend(data, {continue: undefined}),
                shouldContinue
              )
            : data
      );
  }

  private successRace<T>(promises: ng.IPromise<T>[]): ng.IPromise<T> {
    return this.$q<T>((resolve, reject) => {
      // resolve first successful one
      promises.forEach(promise => promise.then(resolve));
      // reject when all fail
      this.$q.all(promises).catch(reject);
    });
  }
}
