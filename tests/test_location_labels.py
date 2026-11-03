import copy
import json
import threading
import unittest
import test_inventory
from lab_server import write_json
from location_labels import assign_labels, empty_labels

class LocationLabels(unittest.TestCase):
    setUp=test_inventory.InventoryTests.setUp
    tearDown=test_inventory.InventoryTests.tearDown
    request=test_inventory.InventoryTests.request
    login=test_inventory.InventoryTests.login
    restart=test_inventory.InventoryTests.restart

    def test_backfill_retained_ids_repeatable_and_restore_collisions(self):
        lab=self.request('GET','/api/lab')[1]
        original=copy.deepcopy(lab)
        shelf=next(i for i in lab['items'] if i['kind']=='shelf')
        shelf['locationId']='S-1'
        new=copy.deepcopy(shelf);new.update(id='S-35fc87b69acc48237949dd0cf7b4c109');new.pop('locationId')
        lab['items'].append(new)
        write_json(self.data/'lab.json',lab)
        # Retained identity is absent from current geometry.
        write_json(self.data/'history/lab/999.json',dict(layout=dict(original,items=[dict(new,id='retained',locationId='S-2')])))
        self.restart()
        saved=self.request('GET','/api/lab')[1]
        self.assertEqual(next(i for i in saved['items'] if i['id']==new['id'])['locationId'],'S-3')
        self.assertEqual(next(i for i in saved['items'] if i['id']==shelf['id'])['locationId'],'S-1')
        self.assertEqual(saved['revision'],lab['revision'])
        raw=(self.data/'lab.json').read_bytes();self.restart();self.assertEqual((self.data/'lab.json').read_bytes(),raw)
        self.login()
        registry=json.loads((self.data/'location-labels.json').read_text())
        restore=copy.deepcopy(saved);next(i for i in restore['items'] if i['id']==new['id'])['locationId']='S-1'
        repaired=assign_labels(restore,registry,repair=True)
        self.assertEqual(next(i for i in restore['items'] if i['id']==new['id'])['locationId'],'S-3')
        self.assertEqual(repaired['labels'][new['id']],'S-3')
        self.assertEqual(self.request('PUT','/api/lab',dict(saved,items=[dict(i,locationId='S-1') if i['id']==new['id'] else i for i in saved['items']]))[0],400)

    def test_concurrent_creation_copy_authorization_and_stable_labels(self):
        self.assertEqual(self.request('POST','/api/location-labels',{'shelfId':'S-aaaaaaaa'})[0],403)
        self.login();results=[]
        def allocate(i):
            results.append(self.request('POST','/api/location-labels',{'shelfId':'S-'+str(i).zfill(16)}))
        threads=[threading.Thread(target=allocate,args=(i,)) for i in range(8)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual([r[0] for r in results],[200]*8)
        labels=[r[1]['locationId'] for r in results];self.assertEqual(len(set(labels)),8)
        again=self.request('POST','/api/location-labels',{'shelfId':'S-'+str(0).zfill(16)})[1]['locationId']
        registry=json.loads((self.data/'location-labels.json').read_text())
        self.assertEqual(again,registry['labels']['S-'+str(0).zfill(16)])

if __name__=='__main__':unittest.main()
