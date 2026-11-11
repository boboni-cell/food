import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilters } from '../public/filters.js';
const filters={distance:100,radius:500,budget:15000,diet:'all',includeUnknownPrice:true,includeUnknownDiet:true};
test('missing prices do not empty the initial restaurant list; strict budget remains available',()=>{
  const discovered={price:null,diet:'unknown'};
  assert.equal(matchesFilters(discovered,filters),true);
  assert.equal(matchesFilters(discovered,{...filters,includeUnknownPrice:false}),false);
  assert.equal(matchesFilters({price:16000,diet:'unknown'},filters),false);
  assert.equal(matchesFilters({price:12000,diet:'unknown'},{...filters,includeUnknownPrice:false}),true);
  assert.equal(matchesFilters(discovered,{...filters,budget:0,includeUnknownPrice:false}),true);
});
test('unknown-price option never bypasses vegetarian verification or location radius',()=>{
  assert.equal(matchesFilters({price:null,diet:'unknown'},{...filters,diet:'veg'}),false);
  assert.equal(matchesFilters({price:null,diet:'meat'},{...filters,diet:'veg'}),false);
  assert.equal(matchesFilters({price:null,diet:'mixed'},{...filters,diet:'veg'}),true);
  assert.equal(matchesFilters({price:10000,diet:'veg'},{...filters,diet:'veg',distance:501}),false);
});

test('regression: mixed diet, 15000 KRW and 1km can draw new unconfirmed restaurants only with opt-in',()=>{
  const discovered={price:null,diet:'unknown'};
  const selected={...filters,distance:700,radius:1000,diet:'mixed'};
  assert.equal(matchesFilters(discovered,selected),true);
  assert.equal(matchesFilters(discovered,{...selected,includeUnknownDiet:false}),false);
  assert.equal(matchesFilters(discovered,{...selected,includeUnknownPrice:false}),false);
  assert.equal(matchesFilters(discovered,{...selected,diet:'veg'}),false);
  assert.equal(matchesFilters({price:20000,diet:'mixed'},selected),false);
  assert.equal(matchesFilters({price:10000,diet:'meat'},selected),false);
});
