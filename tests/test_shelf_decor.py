import copy
import unittest
import test_server
from lab_server import blank_shelf, validate_shelf


def decor(shape='rectangle'):
    return dict(id='D-'+shape, shape=shape, x=.25, y=.5, w=4.5, h=3.25,
                text='Decor-only token', outlineWidth=3, outlineColor='#123456',
                fillColor='#abcdef', textColor='#ffffff')


class DecorTests(unittest.TestCase):
    setUp = test_server.ServerTests.setUp
    tearDown = test_server.ServerTests.tearDown
    request = test_server.ServerTests.request
    login = test_server.ServerTests.login

    def test_validation_and_legacy(self):
        shelf = blank_shelf('example')
        validate_shelf(shelf, 'example')
        shelf['decor'] = [decor(s) for s in ('rectangle', 'ellipse', 'triangle')]
        validate_shelf(shelf, 'example')
        for field, value in [('w', 0), ('h', -1), ('x', .1), ('x', float('nan')),
                             ('outlineWidth', 21), ('fillColor', 'red'), ('shape', 'bin'), ('text', 5)]:
            invalid = copy.deepcopy(shelf)
            invalid['decor'][0][field] = value
            with self.assertRaises(ValueError):
                validate_shelf(invalid, 'example')
        shelf['decor'].append(shelf['decor'][0])
        with self.assertRaises(ValueError):
            validate_shelf(shelf, 'example')

    def test_decor_versions_modes_and_search(self):
        self.login()
        shelf = self.request('GET', '/api/shelves/R01')[1]
        shelf['decor'] = [decor(s) for s in ('rectangle', 'ellipse', 'triangle')]
        for mode in ('simple', 'complex', 'simple'):
            shelf['mode'] = mode
            response = self.request('PUT', '/api/shelves/R01', shelf)
            self.assertEqual(response[0], 200)
            shelf['revision'] = response[1]['revision']
            self.assertEqual(self.request('GET', '/api/shelves/R01')[1]['decor'], shelf['decor'])
        self.request('POST', '/api/logout', {})
        self.assertEqual(self.request('GET', '/api/shelves/R01')[1]['decor'], shelf['decor'])
        self.assertNotIn('decor-only', self.request('GET', '/api/shelf-index')[1]['R01']['searchText'])
        self.login()
        lab = self.request('GET', '/api/lab')[1]
        restored = self.request('POST', '/api/lab/restore', dict(version='1', revision=lab['revision']), {'X-Editor-Instance':'restore-decor'})
        self.assertEqual(restored[0], 200)
        draft = self.request('GET', '/api/drafts/shelves/R01', headers={'X-Editor-Instance':'restore-decor'})[1]
        self.assertEqual(draft['data']['decor'], shelf['decor'])


if __name__ == '__main__':
    unittest.main()
