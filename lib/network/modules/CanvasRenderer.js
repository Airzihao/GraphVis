/**
 * Initializes window.requestAnimationFrame() to a usable form.
 *
 * Specifically, set up this method for the case of running on node.js with jsdom enabled.
 *
 * NOTES:
 *
 * * On node.js, when calling this directly outside of this class, `window` is not defined.
 *   This happens even if jsdom is used.
 * * For node.js + jsdom, `window` is available at the moment the constructor is called.
 *   For this reason, the called is placed within the constructor.
 * * Even then, `window.requestAnimationFrame()` is not defined, so it still needs to be added.
 * * During unit testing, it happens that the window object is reset during execution, causing
 *   a runtime error due to missing `requestAnimationFrame()`. This needs to be compensated for,
 *   see `_requestNextFrame()`.
 * * Since this is a global object, it may affect other modules besides `Network`. With normal
 *   usage, this does not cause any problems. During unit testing, errors may occur. These have
 *   been compensated for, see comment block in _requestNextFrame().
 *
 * @private
 */
function _initRequestAnimationFrame() {
  var func;

  if (window !== undefined) {
    func = window.requestAnimationFrame
        || window.mozRequestAnimationFrame
        || window.webkitRequestAnimationFrame
        || window.msRequestAnimationFrame;
  }

  if (func === undefined) {
    // window or method not present, setting mock requestAnimationFrame
    window.requestAnimationFrame =
     function(callback) {
       //console.log("Called mock requestAnimationFrame");
       callback();
     }
  } else {
     window.requestAnimationFrame = func;
  }
}

let util = require('../../util');

/**
 * The canvas renderer
 */
class CanvasRenderer {
  /**
   * @param {Object} body
   * @param {Canvas} canvas
   */
  constructor(body, canvas) {
    _initRequestAnimationFrame();
    this.body = body;
    this.canvas = canvas;

    this.redrawRequested = false;
    this.renderTimer = undefined;
    this.requiresTimeout = true;
    this.renderingActive = false;
    this.renderRequests = 0;
    this.allowRedraw = true;

    this.dragging = false;
    this.options = {};
    this.defaultOptions = {
      hideEdgesOnDrag: false,
      hideNodesOnDrag: false
    };
    util.extend(this.options, this.defaultOptions);

    this._determineBrowserMethod();
    this.bindEventListeners();
  }

  /**
   * Binds event listeners
   */
  bindEventListeners() {
    this.body.emitter.on("dragStart", () => { this.dragging = true; });
    this.body.emitter.on("dragEnd", () => { this.dragging = false; });
    this.body.emitter.on("_resizeNodes", () => { this._resizeNodes(); });
    this.body.emitter.on("_redraw", () => {
      if (this.renderingActive === false) {
        this._redraw();
      }
    });
    this.body.emitter.on("_blockRedraw", () => {this.allowRedraw = false;});
    this.body.emitter.on("_allowRedraw", () => {this.allowRedraw = true; this.redrawRequested = false;});
    this.body.emitter.on("_requestRedraw", this._requestRedraw.bind(this));
    this.body.emitter.on("_startRendering", () => {
      this.renderRequests += 1;
      this.renderingActive = true;
      this._startRendering();
    });
    this.body.emitter.on("_stopRendering", () => {
      this.renderRequests -= 1;
      this.renderingActive = this.renderRequests > 0;
      this.renderTimer = undefined;
    });
    this.body.emitter.on('destroy',  () => {
      this.renderRequests = 0;
      this.allowRedraw = false;
      this.renderingActive = false;
      if (this.requiresTimeout === true) {
        clearTimeout(this.renderTimer);
      }
      else {
        window.cancelAnimationFrame(this.renderTimer);
      }
      this.body.emitter.off();
    });

  }

  /**
   *
   * @param {Object} options
   */
  setOptions(options) {
    if (options !== undefined) {
      let fields = ['hideEdgesOnDrag','hideNodesOnDrag'];
      util.selectiveDeepExtend(fields,this.options, options);
    }
  }


  /**
   * Prepare the drawing of the next frame.
   *
   * Calls the callback when the next frame can or will be drawn.
   *
   * @param {function} callback
   * @param {number} delay - timeout case only, wait this number of milliseconds
   * @returns {function|undefined}
   * @private
   */
  _requestNextFrame(callback, delay) { 
    // During unit testing, it happens that the mock window object is reset while
    // the next frame is still pending. Then, either 'window' is not present, or
    // 'requestAnimationFrame()' is not present because it is not defined on the
    // mock window object.
    //
    // As a consequence, unrelated unit tests may appear to fail, even if the problem
    // described happens in the current unit test.
    //
    // This is not something that will happen in normal operation, but we still need
    // to take it into account.
    //
    if (typeof window === 'undefined') return;  // Doing `if (window === undefined)` does not work here!

    let timer;

    var myWindow = window;  // Grab a reference to reduce the possibility that 'window' is reset
                            // while running this method.

    if (this.requiresTimeout === true) {
      // wait given number of milliseconds and perform the animation step function
      timer = myWindow.setTimeout(callback, delay);
    } else {
      if (myWindow.requestAnimationFrame) {
        timer = myWindow.requestAnimationFrame(callback);
      }
    }

    return timer;
  }

  /**
   *
   * @private
   */
  _startRendering() {
    if (this.renderingActive === true) {
      if (this.renderTimer === undefined) {
        this.renderTimer = this._requestNextFrame(this._renderStep.bind(this), this.simulationInterval);
      }
    }
  }

  /**
   *
   * @private
   */
  _renderStep() {
    if (this.renderingActive === true) {
      // reset the renderTimer so a new scheduled animation step can be set
      this.renderTimer = undefined;

      if (this.requiresTimeout === true) {
        // this schedules a new simulation step
        this._startRendering();
      }

      this._redraw();

      if (this.requiresTimeout === false) {
        // this schedules a new simulation step
        this._startRendering();
      }
    }
  }

  /**
   * Redraw the network with the current data
   * chart will be resized too.
   */
  redraw() {
    this.body.emitter.emit('setSize');
    this._redraw();
  }

  /**
   * Redraw the network with the current data
   * @private
   */
  _requestRedraw() {
    if (this.redrawRequested !== true && this.renderingActive === false && this.allowRedraw === true) {
      this.redrawRequested = true;
      this._requestNextFrame(() => {this._redraw(false);}, 0);
    }
  }

  /**
   * Redraw the network with the current data
   * @param {boolean} [hidden=false] | Used to get the first estimate of the node sizes.
   *                                   Only the nodes are drawn after which they are quickly drawn over.
   * @private
   */
  _redraw(hidden = false) {
    if (this.allowRedraw === true) {
      this.body.emitter.emit("initRedraw");

      this.redrawRequested = false;

      // when the container div was hidden, this fixes it back up!
      if (this.canvas.frame.canvas.width === 0 || this.canvas.frame.canvas.height === 0) {
        this.canvas.setSize();
      }

      this.canvas.setTransform();

      let ctx = this.canvas.getContext();

      // clear the canvas
      let w = this.canvas.frame.canvas.clientWidth;
      let h = this.canvas.frame.canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      // if the div is hidden, we stop the redraw here for performance.
      if (this.canvas.frame.clientWidth === 0) {
        return;
      }

      // set scaling and translation
      ctx.save();
      ctx.translate(this.body.view.translation.x, this.body.view.translation.y);
      ctx.scale(this.body.view.scale, this.body.view.scale);

      ctx.beginPath();
      this.body.emitter.emit("beforeDrawing", ctx);
      ctx.closePath();

      this._drawZones(ctx)
      if (hidden === false) {
        if (this.dragging === false || (this.dragging === true && this.options.hideEdgesOnDrag === false)) {
          this._drawEdges(ctx);
        }
      }

      if (this.dragging === false || (this.dragging === true && this.options.hideNodesOnDrag === false)) {
        this._drawNodes(ctx, hidden);
      }

      ctx.beginPath();
      this.body.emitter.emit("afterDrawing", ctx);
      ctx.closePath();


      // restore original scaling and translation
      ctx.restore();
      if (hidden === true) {
        ctx.clearRect(0, 0, w, h);
      }
    }
  }

  /**
   * Draw community zones
   * @param {CanvasRenderingContext2D} ctx
   * 
   */
  _drawZones(ctx){
    var nodeList =[[[]]]
    nodeList[0] = [[1705,648],[1755,754],[1765,871],[1735,985],[1668,1082],[1572,1149],[1459,1180],[1342,1171],[1235,1121],[1151,1039],[1076,1076],[985,1106],[888,1104],[798,1068],[726,1005],[638,944],[559,863],[513,760],[505,648],[535,539],[601,448],[695,384],[804,356],[911,361],[956,309],[1004,242],[1072,196],[1151,177],[1233,185],[1311,208],[1388,238],[1450,292],[1525,334],[1605,386],[1663,462],[1691,553]]
    nodeList[1] = [[954,-98],[929,1],[872,87],[789,149],[690,178],[608,196],[567,259],[507,305],[439,349],[360,369],[273,393],[171,420],[66,411],[-29,366],[-103,291],[-162,203],[-205,107],[-213,2],[-185,-98],[-126,-184],[-64,-253],[17,-296],[82,-332],[89,-422],[126,-504],[189,-569],[270,-608],[360,-674],[469,-716],[586,-717],[696,-679],[786,-605],[845,-505],[867,-391],[917,-301],[947,-202]]
    nodeList[2] = [[-435,195],[-407,302],[-418,413],[-467,513],[-538,597],[-586,709],[-670,797],[-779,852],[-900,866],[-1018,838],[-1119,771],[-1213,729],[-1310,700],[-1391,639],[-1447,555],[-1470,456],[-1458,355],[-1453,272],[-1513,195],[-1552,101],[-1558,-1],[-1555,-114],[-1522,-227],[-1457,-327],[-1373,-420],[-1263,-478],[-1140,-496],[-1018,-470],[-912,-403],[-836,-305],[-797,-186],[-746,-128],[-666,-99],[-601,-45],[-558,27],[-497,103]]
    nodeList[3] = [[2225,-394],[2220,-297],[2183,-208],[2117,-138],[2031,-93],[1972,-39],[1926,42],[1855,104],[1767,137],[1674,139],[1585,108],[1512,49],[1464,-31],[1436,-110],[1379,-147],[1321,-190],[1220,-229],[1137,-299],[1084,-394],[1066,-501],[1085,-608],[1141,-701],[1211,-782],[1286,-856],[1381,-901],[1486,-910],[1587,-883],[1674,-823],[1742,-783],[1828,-818],[1920,-821],[2008,-793],[2081,-736],[2130,-658],[2150,-567],[2196,-486]]  
    nodeList[4] = [[-799,1312],[-828,1392],[-882,1458],[-956,1501],[-1021,1532],[-1073,1562],[-1108,1616],[-1155,1664],[-1216,1694],[-1283,1701],[-1349,1684],[-1411,1663],[-1467,1630],[-1508,1580],[-1533,1522],[-1568,1477],[-1606,1430],[-1625,1372],[-1653,1312],[-1664,1245],[-1652,1178],[-1642,1105],[-1609,1039],[-1556,987],[-1488,957],[-1414,952],[-1343,973],[-1283,1017],[-1235,1038],[-1187,1049],[-1125,1039],[-1041,1024],[-957,1039],[-883,1081],[-828,1146],[-799,1227]]
    nodeList[5] = [[746,-1385],[772,-1299],[768,-1209],[734,-1126],[673,-1060],[593,-1019],[504,-1007],[423,-1009],[356,-991],[286,-999],[223,-1029],[175,-1079],[146,-1142],[101,-1164],[47,-1184],[3,-1221],[-24,-1272],[-55,-1325],[-88,-1385],[-98,-1453],[-84,-1520],[-48,-1578],[5,-1621],[70,-1643],[108,-1694],[161,-1730],[223,-1745],[286,-1739],[344,-1711],[390,-1669],[425,-1625],[442,-1571],[464,-1534],[527,-1524],[615,-1505],[691,-1456]]
    nodeList[6] = [[-1387,-813],[-1435,-767],[-1495,-740],[-1562,-736],[-1599,-732],[-1599,-698],[-1611,-666],[-1633,-640],[-1662,-623],[-1696,-589],[-1739,-566],[-1788,-559],[-1836,-570],[-1878,-596],[-1908,-635],[-1923,-682],[-1922,-731],[-1938,-770],[-1939,-813],[-1925,-853],[-1898,-887],[-1880,-920],[-1865,-955],[-1839,-984],[-1804,-1001],[-1766,-1006],[-1728,-998],[-1696,-1040],[-1648,-1086],[-1587,-1112],[-1520,-1117],[-1456,-1098],[-1403,-1059],[-1366,-1004],[-1350,-939],[-1357,-873]]
    nodeList[7] = [[27,-817],[-1,-722],[-50,-638],[-106,-566],[-183,-517],[-220,-435],[-278,-363],[-358,-315],[-449,-298],[-540,-313],[-621,-358],[-682,-428],[-736,-476],[-812,-492],[-878,-533],[-926,-594],[-985,-655],[-1022,-732],[-1031,-817],[-1048,-906],[-1055,-1004],[-1028,-1098],[-970,-1178],[-889,-1233],[-796,-1260],[-718,-1304],[-629,-1319],[-540,-1303],[-457,-1289],[-378,-1262],[-313,-1209],[-270,-1138],[-174,-1124],[-85,-1079],[-17,-1007],[21,-916]]
    nodeList[8] = [[1679,1546],[1652,1640],[1595,1719],[1515,1774],[1421,1798],[1324,1788],[1236,1746],[1196,1753],[1162,1780],[1121,1822],[1068,1847],[1009,1852],[953,1838],[904,1804],[849,1775],[801,1731],[770,1674],[753,1611],[751,1546],[771,1485],[811,1433],[866,1399],[926,1382],[942,1333],[969,1283],[1011,1245],[1064,1223],[1121,1222],[1175,1239],[1220,1274],[1284,1263],[1379,1239],[1476,1249],[1563,1291],[1631,1360],[1671,1449]]
    nodeList[9] = [[83,-2008],[49,-1929],[-9,-1867],[-85,-1828],[-170,-1818],[-254,-1838],[-295,-1831],[-334,-1837],[-353,-1760],[-397,-1687],[-463,-1632],[-544,-1603],[-635,-1595],[-726,-1616],[-803,-1667],[-858,-1742],[-885,-1831],[-879,-1923],[-843,-2008],[-779,-2076],[-696,-2117],[-604,-2128],[-514,-2106],[-513,-2147],[-520,-2222],[-501,-2294],[-458,-2356],[-397,-2400],[-324,-2419],[-249,-2413],[-181,-2381],[-128,-2329],[-60,-2291],[11,-2244],[62,-2176],[87,-2094]]
    nodeList[10] = [[165,979],[200,1003],[246,1044],[276,1099],[285,1161],[272,1222],[239,1275],[190,1314],[131,1333],[68,1332],[10,1308],[-35,1267],[-65,1212],[-74,1150],[-61,1089],[-102,1078],[-139,1055],[-167,1021],[-181,979],[-179,936],[-163,895],[-134,862],[-95,841],[-59,827],[-47,777],[-20,734],[20,704],[68,689],[119,691],[166,711],[204,745],[227,790],[233,841],[222,891],[195,933],[171,961]]


    var colorList = ['rgba(135,206,250,0.2)','rgba(255,192,203,0.2)','rgba(230,230,250,0.5)','rgba(	100,149,237,0.2)','rgba(135,206,250,0.2)','rgba(127,255,170,0.2)','rgba(255,255,224,0.4)','rgba(255,228,181,0.2)','rgba(255,218,185,0.2)','rgba(250,128,114,0.2)','rgba(178,34,34,0.2)']
    for(let i=0;i<nodeList.length;i++){
      fillZone(ctx , nodeList[i],colorList[i]);
    }
    
    function fillZone(ctx, nodeList, fillColor, alpha){
      ctx.save();
      pathZone(ctx,nodeList)
      ctx.fillStyle = fillColor;
      //ctx.globalAlpha=0.2||alpha;
      ctx.fill();
      ctx.restore();
  }
  function pathZone(ctx, nodeList){
      ctx.beginPath();
      ctx.moveTo(nodeList[0][0],nodeList[0][1]);
      for (let i=1;i<nodeList.length-1;i++){
          var node0 = nodeList[i]
          var node1 = nodeList[i+1]
          ctx.quadraticCurveTo(node0[0],node0[1],(node0[0]+node1[0])/2,(node0[1]+node1[1])/2)
          
      }
      //ctx.quadraticCurveTo((nodeList[0][0]+nodeList[nodeList.length-1][1])/2,(nodeList[0][1]+nodeList[nodeList.length-1][1])/2,nodeList[0][0],nodeList[0][1])
      ctx.lineTo(nodeList[nodeList.length-1][0],nodeList[nodeList.length-1][1])
      ctx.closePath();
  }
  }
  

  /**
   * Redraw all nodes
   *
   * @param {CanvasRenderingContext2D}   ctx
   * @param {boolean} [alwaysShow]
   * @private
   */
  _resizeNodes() {
    this.canvas.setTransform();
    let ctx = this.canvas.getContext();
    ctx.save();
    ctx.translate(this.body.view.translation.x, this.body.view.translation.y);
    ctx.scale(this.body.view.scale, this.body.view.scale);

    let nodes = this.body.nodes;
    let node;

    // resize all nodes
    for (let nodeId in nodes) {
      if (nodes.hasOwnProperty(nodeId)) {
        node = nodes[nodeId];
        node.resize(ctx);
        node.updateBoundingBox(ctx, node.selected);
      }
    }

    // restore original scaling and translation
    ctx.restore();
  }

  /**
   * Redraw all nodes
   *
   * @param {CanvasRenderingContext2D} ctx  2D context of a HTML canvas
   * @param {boolean} [alwaysShow]
   * @private
   */
  _drawNodes(ctx, alwaysShow = false) {
    let nodes = this.body.nodes;
    let nodeIndices = this.body.nodeIndices;
    let node;
    let selected = [];
    let margin = 20;
    let topLeft = this.canvas.DOMtoCanvas({x:-margin,y:-margin});
    let bottomRight = this.canvas.DOMtoCanvas({
      x: this.canvas.frame.canvas.clientWidth+margin,
      y: this.canvas.frame.canvas.clientHeight+margin
    });
    let viewableArea = {top:topLeft.y,left:topLeft.x,bottom:bottomRight.y,right:bottomRight.x};

    // draw unselected nodes;
    for (let i = 0; i < nodeIndices.length; i++) {
      
      node = nodes[nodeIndices[i]];
      //console.log(node.id,node.x,node.y)
      // set selected nodes aside
      if (node.isSelected()) {
        selected.push(nodeIndices[i]);
      }
      else {
        if (alwaysShow === true) {
          node.draw(ctx);
        }
        else if (node.isBoundingBoxOverlappingWith(viewableArea) === true) {
          node.draw(ctx);
        }
        else {
          node.updateBoundingBox(ctx, node.selected);
        }
      }
    }

    // draw the selected nodes on top
    for (let i = 0; i < selected.length; i++) {
      node = nodes[selected[i]];
      node.draw(ctx);
    }
  }


  /**
   * Redraw all edges
   * @param {CanvasRenderingContext2D} ctx  2D context of a HTML canvas
   * @private
   */
  _drawEdges(ctx) {
    let edges = this.body.edges;
    let edgeIndices = this.body.edgeIndices;
    let edge;

    for (let i = 0; i < edgeIndices.length; i++) {
      edge = edges[edgeIndices[i]];
      if (edge.connected === true) {
        edge.draw(ctx);
      }
    }
  }

  /**
   * Determine if the browser requires a setTimeout or a requestAnimationFrame. This was required because
   * some implementations (safari and IE9) did not support requestAnimationFrame
   * @private
   */
  _determineBrowserMethod() {
    if (typeof window !== 'undefined') {
      let browserType = navigator.userAgent.toLowerCase();
      this.requiresTimeout = false;
      if (browserType.indexOf('msie 9.0') != -1) { // IE 9
        this.requiresTimeout = true;
      }
      else if (browserType.indexOf('safari') != -1) {  // safari
        if (browserType.indexOf('chrome') <= -1) {
          this.requiresTimeout = true;
        }
      }
    }
    else {
      this.requiresTimeout = true;
    }
  }
}

export default CanvasRenderer;
