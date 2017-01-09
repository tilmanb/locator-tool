import angular from 'angular';
import localStorage from 'angular-local-storage';
import uiRouter from 'angular-ui-router';
import gettext from 'angular-gettext';

import appApi from './api';
import appComponents from './components';

angular.module('app', [uiRouter, localStorage, gettext, appApi, appComponents]);

angular.module('app').config(routes);

routes.$inject = ['$stateProvider', '$urlRouterProvider'];
function routes($stateProvider, $urlRouterProvider) {
  $stateProvider.state('about', {
    url: '/',
    component: 'ltAbout'
  });

  $stateProvider.state('select', {
    url: '/select?user&category',
    component: 'ltFilesSelector'
  });

  $stateProvider.state('geolocate', {
    url: '/geolocate?files&user&category',
    component: 'ltMain'
  });

  $urlRouterProvider.otherwise('/');
}

/* eslint-env browser */
angular.element(document).ready(() => {
  angular.bootstrap(document, ['app'], {strictDi: true});
});
