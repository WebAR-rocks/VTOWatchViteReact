import React, { useEffect, useRef, useState, Suspense } from 'react'
import test_isMobile from 'is-mobile'
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber'
import {
  ACESFilmicToneMapping,
  CylinderGeometry,
  Mesh,
  MeshNormalMaterial,
  Vector3
} from 'three'
// import GLTF loader - originally in examples/jsm/loaders/
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Environment } from '@react-three/drei'

// 1 neural network approach:
import NNWrist from '../WebARRocksHand/neuralNets/NN_WRISTBACK_23.json'

// This helper is not minified, feel free to customize it:
import VTOThreeHelper from '../WebARRocksHand/helpers/HandTrackerThreeHelper.js'

//import PoseFlipFilter
import PoseFlipFilter from '../WebARRocksHand/helpers/PoseFlipFilter.js'

// import stabilizer:
import Stabilizer from '../WebARRocksHand/helpers/landmarksStabilizers/OneEuroLMStabilizer.js'

// ASSETS:
// import 3D models:
import GLTFModelWrist from '../assets/watchCasio.glb'

// import HDR environment
import HDRIEnv from '../assets/hotel_room_1k.hdr'



const SETTINGS = {
  threshold: 0.98, // detection sensitivity, between 0 and 1
  
  poseLandmarksLabels: [
  // wristRightBottom not working
    //"wristBack", "wristLeft", "wristRight", "wristPalm", "wristPalmTop", "wristBackTop", "wristRightBottom", "wristLeftBottom" // more accurate
    "wristBack", "wristRight", "wristPalm", "wristPalmTop", "wristBackTop", "wristLeft" // more stable
   ],
  isPoseFilter: true,

  // soft occluder parameters (soft because we apply a fading gradient)
  occluder: {
    radiusRange: [4, 4.7], // first value: minimum or interior radius of the occluder (full transparency).
                           // second value: maximum or exterior radius of the occluder (full opacity, no occluding effect)
    height: 48, // height of the cylinder
    offset: [0,0,0], // relative to the wrist 3D model
    quaternion: [0.707,0,0,0.707], // rotation of Math.PI/2 along X axis,
    flattenCoeff: 0.6, // 1 -> occluder is a cylinder 0.5 -> flatten by 50%
  },
  objectPointsPositionFactors: [1.0, 1.3, 1.0], // factors to apply to point positions to lower pose angles - dirty tweak

  stabilizerOptions: {
    minCutOff: 0.001,
    beta: 5,
    freqRange: [2, 144],
    forceFilterNNInputPxRange: [2.5, 6],//[1.5, 4],
  },

  pose: {
    scale: 1.3 * 1.462,
    offset: [0.076, -0.916, -0.504],
    quaternion: [0,0,0,1],
  }
}


// fake component, display nothing
// just used to get the Camera and the renderer used by React-fiber:
const ThreeGrabber = (props) => {
  const threeFiber = useThree()

  // tweak encoding:
  const threeRenderer = threeFiber.gl
  threeRenderer.toneMapping = ACESFilmicToneMapping
  
  useFrame(VTOThreeHelper.update_threeCamera.bind(null, props.sizing, threeFiber.camera))
  
  return null
}


const compute_sizing = () => {
  // compute  size of the canvas:
  const height = window.innerHeight
  const wWidth = window.innerWidth
  const width = Math.min(wWidth, height)

  // compute position of the canvas:
  const top = 0
  const left = (wWidth - width ) / 2
  return {width, height, top, left}
}


const create_softOccluder = (occluder) => {
  const occluderRadius = occluder.radiusRange[1]
  const occluderMesh = new Mesh(
    new CylinderGeometry(occluderRadius, occluderRadius, occluder.height, 32, 1, true),
    new MeshNormalMaterial()
  )
  const dr = occluder.radiusRange[1] - occluder.radiusRange[0]
  occluderMesh.position.fromArray(occluder.offset)
  occluderMesh.quaternion.fromArray(occluder.quaternion)
  occluderMesh.scale.set(1.0, 1.0, occluder.flattenCoeff);
  
  occluderMesh.userData = {
    isOccluder: true,
    isSoftOccluder: true,
    softOccluderRadius: occluderRadius,
    softOccluderDr: dr
  }
  return occluderMesh
}


const VTOModelContainer = (props) => {
  const objRef = useRef()
  useEffect(() => {
    const threeObject3DParent = objRef.current
    const threeObject3D = threeObject3DParent.children[0]
    VTOThreeHelper.set_handRightFollower(threeObject3DParent, threeObject3D)
  })
  
  // import main model:
  const gltf = useLoader(GLTFLoader, props.GLTFModel)
  const model = gltf.scene.children[0].clone()

  // set model pose:
  if (props.pose.scale){
    const s = props.pose.scale
    model.scale.set(s, s, s)
  }
  if (props.pose.translation){
    model.position.add(new Vector3().fromArray(props.pose.translation))
  }
  if (props.pose.quaternion){
    model.quaternion.fromArray(props.pose.quaternion)
  }

  // add soft cylinder occluder:
  const occluderModel = create_softOccluder(props.occluder)  
  
  
  return (
    <object3D ref={objRef}>
      <object3D>
        <object3D>
          <primitive object={model} />
          {
            (occluderModel) &&
             (
              <primitive object={occluderModel} />
             )
          }
        </object3D>        
      </object3D>
    </object3D>
    )
}


const DebugCube = (props) => {
  const s = props.size || 1.0
  return (
    <mesh name="debugCube">
      <boxGeometry args={[s, s, s]} />
      <meshNormalMaterial />
    </mesh>
    )
}


const get_pose = (model) => {
  // convert from Blender to THREE (inv YZ):
  const t = model.translation
  const translation = [t[0], t[2], -t[1]]

  // convert from Blender to THREE quaternion:
  const q = model.quaternion
  const quaternion = [q[0], q[2], -q[1], q[3]]

  // pose of the 3D model:
  const pose = {
    translation,
    scale: model.scale,
    quaternion
  }
  return pose
}


const VTO = () => {
  const isMobile = test_isMobile()

  // state initialization:
  const [sizing, setSizing] = useState(compute_sizing())  
  const [isSelfieCam, setIsSelfieCam] = useState(true)
  const [isInitialized, setIsInitialized] = useState(false)


  // handle resizing:
  let _timerResize = null
  const handle_resize = () => {
    // do not resize too often:
    if (_timerResize){
      clearTimeout(_timerResize)
    }
    _timerResize = setTimeout(do_resize, 200)
  }


  const do_resize = () => {
    _timerResize = null
    const newSizing = compute_sizing()
    setSizing(newSizing)
  }


  useEffect(() => {
    if (!_timerResize && isInitialized){
      VTOThreeHelper.resize()
    }
  }, [sizing])


  const canvasVideoRef = useRef()
  useEffect(() => {
    // init WEBARROCKSHAND through the helper:
    const poseFilter = (SETTINGS.isPoseFilter) ? PoseFlipFilter.instance({}) : null
    VTOThreeHelper.init({
      objectPointsPositionFactors: SETTINGS.objectPointsPositionFactors,
      poseLandmarksLabels: SETTINGS.poseLandmarksLabels,
      poseFilter,
      enableFlipObject: true,
      cameraZoom: 1,
      threshold: SETTINGS.threshold,
      handTrackerCanvas: canvasVideoRef.current,
      debugDisplayLandmarks: false, // true to display landmarks
      NNs: [NNWrist],
      maxHandsDetected: 1,
      landmarksStabilizerSpec: SETTINGS.stabilizerOptions,
      stabilizationSettings: {
        switchNNErrorThreshold: 0.2,
        NNSwitchMask: {
          isRightHand: true,
          isFlipped: false
        }
      },
      scanSettings: {
        translationScalingFactors: [0.3,0.3,0.3],
      },
      videoSettings: {
        facingMode: 'user'
      },
    }, Stabilizer).then(() => {
      console.log('VTOThreeHelper is initialized')
      // handle resizing / orientation change:
      window.addEventListener('resize', handle_resize)
      window.addEventListener('orientationchange', handle_resize)
      setIsInitialized(true)
    })

    return VTOThreeHelper.destroy
  }, [])
 

  const flip_camera = () => {
    VTOThreeHelper.update_videoSettings({
      facingMode: (isSelfieCam) ? 'environment' : 'user'
    }).then(() => {
      setIsSelfieCam(!isSelfieCam)
    }).catch((err) => {
      console.log('ERROR: Cannot flip camera -', err)
    })
  }


  const mirrorClass = (isSelfieCam) ? 'mirrorX' : ''
  return (
    <div>

      {
        (!isInitialized) && (
          <div className='loadingModal'>
            <div>
              LOADING...
            </div>
          </div>
        )
      }

      {/* Canvas managed by three fiber, for AR: */}
      <Canvas className={mirrorClass} style={{
        position: 'fixed',
        zIndex: 2,
        ...sizing
      }}
      gl={{
        preserveDrawingBuffer: true // allow image capture
      }}
      //updateDefaultCamera = {false}
      >

        <Environment files={HDRIEnv} />

        <ThreeGrabber sizing={sizing}/>
        
        <Suspense fallback={<DebugCube />}>
          <VTOModelContainer GLTFModel={GLTFModelWrist} occluder={SETTINGS.occluder} pose={SETTINGS.pose} />
        </Suspense>

        <pointLight color={0xffffff} intensity={1} position={[0,100,0]} />
        <ambientLight color={0xffffff} intensity={0.3} />
      </Canvas>

    {/* Canvas managed by WebAR.rocks, just displaying the video (and used for WebGL computations) */}
      <canvas className={mirrorClass} ref={canvasVideoRef} style={{
        position: 'fixed',
        zIndex: 1,
        ...sizing
      }} width = {sizing.width} height = {sizing.height} />

      {
        (isMobile) && (
          <div className="VTOButtons">
            <button className='FlipCamButton' onClick={flip_camera}>Flip camera</button>
          </div>
          )
      }
      

    </div>
  )
} 


export default VTO
